/* Emulate the native <audio> element with Web Audio API */
import { BANDS, MEDIA_STATUS } from "../constants";
// Safari does not, yet, support the StereoPannerNode, so we use this polyfill
// Hopefully this can be removed in thefuture.
import SteroPannerNode from "stereo-panner-node";
import Emitter from "../emitter";
import ElementSource from "./elementSource";
import { Band } from "../types";

function createStereoPanner(context: AudioContext): StereoPannerNode {
  if ("createStereoPanner" in context) {
    return context.createStereoPanner();
  }
  return new SteroPannerNode(context);
}

export default class Media {
  _emitter: Emitter;
  _context: AudioContext;
  _balance: number;
  _staticSource: AnalyserNode;
  _preamp: GainNode;
  _panner: StereoPannerNode;
  _analyser: AnalyserNode;
  _gainNode: GainNode;
  _source: ElementSource;
  _bands: { [band: number]: BiquadFilterNode };

  constructor() {
    this._emitter = new Emitter();
    // @ts-ignore Typescript does not know about webkitAudioContext
    this._context = new (window.AudioContext || window.webkitAudioContext)();
    // Fix for iOS and Chrome (Canary) which require that the context be created
    // or resumed by a user interaction.
    // https://developers.google.com/web/updates/2017/09/autoplay-policy-changes
    // https://gist.github.com/laziel/7aefabe99ee57b16081c
    // Via: https://stackoverflow.com/a/43395068/1263117
    if (this._context.state === "suspended") {
      const resume = async () => {
        await this._context.resume();

        if (this._context.state === "running") {
          // TODO: Add this to the disposable
          document.body.removeEventListener("touchend", resume, false);
          document.body.removeEventListener("click", resume, false);
          document.body.removeEventListener("keydown", resume, false);
        }
      };

      document.body.addEventListener("touchend", resume, false);
      document.body.addEventListener("click", resume, false);
      document.body.addEventListener("keydown", resume, false);
    }
    this._balance = 0;

    // The _source node has to be recreated each time it's stopped or
    // paused, so we don't create it here. Instead we create this dummy
    // node wich the real source will connect to.

    // TODO: Maybe we can get rid of this now that we are using AudioAbstraction?
    this._staticSource = this._context.createAnalyser(); // Just a noop node

    // Create the preamp node
    this._preamp = this._context.createGain();

    // Create the panner node
    this._panner = createStereoPanner(this._context);

    // Create the analyser node for the visualizer
    this._analyser = this._context.createAnalyser();
    this._analyser.fftSize = 2048;
    // don't smooth audio analysis
    this._analyser.smoothingTimeConstant = 0.0;

    // Create the gain node for the volume control
    this._gainNode = this._context.createGain();

    // Connect all the nodes in the correct way
    // (Note, source is created and connected later)
    //
    //                <source>
    //                    |
    //                    |_____________
    //                    |             \
    //                <preamp>          |
    //                    |             | <-- Optional bypass
    //           [...biquadFilters]     |
    //                    |_____________/
    //                    |
    //               <stereoPanner>
    //                    |
    //                    |\
    //                    | <analyser>
    //                  <gain>
    //                    |
    //              <destination>

    this._source = new ElementSource(this._context, this._staticSource);

    this._source.on("positionChange", () => {
      this._emitter.trigger("timeupdate");
    });
    this._source.on("ended", () => {
      this._emitter.trigger("ended");
    });
    this._source.on("statusChange", () => {
      switch (this._source.getStatus()) {
        case MEDIA_STATUS.PLAYING:
          this._emitter.trigger("playing");
          break;
      }
      this._emitter.trigger("timeupdate");
    });
    this._source.on("loaded", () => {
      this._emitter.trigger("fileLoaded");
    });

    this._staticSource.connect(this._preamp);

    let output = this._preamp;
    this._bands = {};

    BANDS.forEach((band, i) => {
      const filter = this._context.createBiquadFilter();

      this._bands[band] = filter;

      if (i === 0) {
        // The first filter, includes all lower frequencies
        filter.type = "lowshelf";
      } else if (i === BANDS.length - 1) {
        // The last filter, includes all higher frequencies
        filter.type = "highshelf";
      } else {
        filter.type = "peaking";
      }
      filter.frequency.value = band;
      filter.gain.value = 0;

      output.connect(filter);
      output = filter;
    });

    output.connect(this._panner);

    this._panner.connect(this._gainNode);
    this._panner.connect(this._analyser);

    this._gainNode.connect(this._context.destination);
  }

  getAnalyser() {
    return this._analyser;
  }

  /* Properties */
  duration() {
    return this._source.getDuration();
  }

  timeElapsed() {
    return this._source.getTimeElapsed();
  }

  timeRemaining() {
    return this.duration() - this.timeElapsed();
  }

  percentComplete() {
    return (this.timeElapsed() / this.duration()) * 100;
  }

  /* Actions */
  async play() {
    await this._source.play();
  }

  pause() {
    this._source.pause();
  }

  stop() {
    this._source.stop();
  }

  /* Actions with arguments */
  seekToPercentComplete(percent: number) {
    const seekTime = this.duration() * (percent / 100);
    this.seekToTime(seekTime);
  }

  // From 0-1
  setVolume(volume: number) {
    this._gainNode.gain.value = volume / 100;
  }

  // From 0-1
  setPreamp(value: number) {
    this._preamp.gain.value = value / 100;
  }

  // From -100 to 100
  setBalance(balance: number) {
    this._panner.pan.setValueAtTime(balance / 100, this._context.currentTime);
  }

  setEqBand(band: Band, value: number) {
    const db = (value / 100) * 24 - 12;
    this._bands[band].gain.value = db;
  }

  disableEq() {
    this._staticSource.disconnect();
    this._staticSource.connect(this._panner);
  }

  enableEq() {
    this._staticSource.disconnect();
    this._staticSource.connect(this._preamp);
  }

  /* Listeners */
  on(event: string, callback: (...args: any[]) => void) {
    this._emitter.on(event, callback);
  }

  seekToTime(time: number) {
    this._source.seekToTime(time);
  }

  // Used only for the initial load, since it must have a CORS header
  async loadFromUrl(url: string, autoPlay: boolean) {
    this._emitter.trigger("waiting");
    await this._source.loadUrl(url);
    this._emitter.trigger("stopWaiting");
    if (autoPlay) {
      this.play();
    }
  }

  dispose() {
    this._source.dispose();
    this._emitter.dispose();
  }
}
