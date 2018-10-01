import fs from "fs";
import path from "path";
import reducer from "./reducers";
import * as Selectors from "./selectors";
import * as Actions from "./actionCreators";
import { kebabCase } from "lodash";

import { createStore, applyMiddleware } from "redux";
import thunk from "redux-thunk";
import { LOAD_SERIALIZED_STATE } from "./actionTypes";
import { SerializedStateV1 } from "./serializedStates/v1Types";
import { Dispatchable, AppState } from "./types";

function fixturePath(name: string) {
  return path.join(
    __dirname,
    "__tests__/fixtures/serializedState/v1/",
    `${kebabCase(name)}.json`
  );
}

function writeFixture(name: string, state: SerializedStateV1) {
  fs.writeFileSync(fixturePath(name), JSON.stringify(state, null, 4));
}

function readFixture(name: string): SerializedStateV1 {
  return JSON.parse(fs.readFileSync(fixturePath(name), "utf8"));
}

interface SerializationTestParams<T> {
  name: string;
  action: Dispatchable;
  selector(state: AppState): T;
  expected: T;
}

function testSerialization<T>({
  name,
  action,
  selector,
  expected
}: SerializationTestParams<T>) {
  test(name, () => {
    const firstStore = getStore();
    firstStore.dispatch(action);
    // Ensure we actually changed something
    expect(firstStore.getState()).not.toEqual(getStore().getState());

    const serializedState = Selectors.getSerlializedState(
      firstStore.getState()
    );

    if (!fs.existsSync(fixturePath(name))) {
      writeFixture(name, serializedState);
      console.warn("Wrote new fixture: ", fixturePath(name));
    }

    const readSerializedState = readFixture(name);

    expect(readSerializedState).toEqual(serializedState);

    const secondStore = getStore();
    secondStore.dispatch({
      type: LOAD_SERIALIZED_STATE,
      serializedState: readSerializedState
    });
    expect(selector(secondStore.getState())).toEqual(expected);
  });
}

const defaultSerializedState = Selectors.getSerlializedState(
  getStore().getState()
);

function getStore() {
  const extras = {};
  const enhancer = applyMiddleware(thunk.withExtraArgument(extras));
  return createStore(reducer, enhancer);
}

describe("can serialize", () => {
  test("the initial state", () => {
    const store = getStore();
    const serializedState = Selectors.getSerlializedState(store.getState());
    expect(serializedState).toMatchSnapshot();

    const newStore = getStore();
    newStore.dispatch({
      type: LOAD_SERIALIZED_STATE,
      serializedState
    });
    expect(store.getState()).toEqual(newStore.getState());
  });

  /* Media */
  testSerialization({
    name: "volume",
    action: Actions.setVolume(50),
    selector: Selectors.getVolume,
    expected: 50
  });

  testSerialization({
    name: "balance",
    action: Actions.setBalance(40),
    selector: Selectors.getBalance,
    expected: 40
  });

  testSerialization({
    name: "shuffle",
    action: Actions.toggleShuffle(),
    selector: Selectors.getShuffle,
    expected: true
  });

  testSerialization({
    name: "repeat",
    action: Actions.toggleRepeat(),
    selector: Selectors.getRepeat,
    expected: true
  });

  /* Equalizer */
  testSerialization({
    name: "equalizer on",
    action: Actions.toggleEq(),
    selector: Selectors.getEqualizerEnabled,
    expected: false
  });

  testSerialization({
    name: "equalizer auto",
    action: Actions.toggleEqAuto(),
    selector: Selectors.getEqualizerAuto,
    expected: true
  });

  testSerialization({
    name: "equalizer band",
    action: Actions.setEqBand(60, 100),
    selector: state => Selectors.getSliders(state)[60],
    expected: 100
  });

  testSerialization({
    name: "equalizer preamp",
    action: Actions.setPreamp(10),
    selector: state => Selectors.getSliders(state).preamp,
    expected: 10
  });

  /* Display */
  testSerialization({
    name: "double mode",
    action: Actions.toggleDoubleSizeMode(),
    selector: Selectors.getDoubled,
    expected: true
  });

  testSerialization({
    name: "llama mode",
    action: Actions.toggleLlamaMode(),
    selector: Selectors.getLlamaMode,
    expected: true
  });

  // TODO
  // * marqueeStep
  // * skinImages
  // * skinCursors
  // * skinRegion
  // * skinGenLetterWidths
  // * skinColors
  // * skinPlaylistStyle
  // * focused

  /* Gen Windows */
  testSerialization({
    name: "window size",
    action: Actions.setWindowSize("playlist", [4, 5]),
    selector: state => Selectors.getWindowSize(state)("playlist"),
    expected: [4, 5]
  });

  testSerialization({
    name: "window open",
    action: Actions.closeWindow("playlist"),
    selector: state => Selectors.getWindowOpen(state)("playlist"),
    expected: false
  });

  testSerialization({
    name: "window hidden",
    action: Actions.hideWindow("playlist"),
    selector: state => Selectors.getWindowHidden(state)("playlist"),
    expected: true
  });

  testSerialization({
    name: "window shade",
    action: Actions.toggleEqualizerShadeMode(),
    selector: state => Selectors.getWindowShade(state)("equalizer"),
    expected: true
  });

  testSerialization({
    name: "main window position",
    action: Actions.updateWindowPositions({ main: { x: 100, y: 100 } }),
    selector: state => Selectors.getWindowPosition(state)("main"),
    expected: { x: 100, y: 100 }
  });

  testSerialization({
    name: "focused window",
    action: Actions.setFocusedWindow("equalizer"),
    selector: state => Selectors.getFocusedWindow(state),
    expected: "equalizer"
  });
});