function click(x, y, holdMs = 160, delay = 0) {
  return { type: "mouse", action: "click", button: "left", x, y, holdMs, delay };
}

function rclick(x, y, holdMs = 160, delay = 0) {
  return { type: "mouse", action: "click", button: "right", x, y, holdMs, delay };
}

function wait(ms, delay = 0) {
  return { type: "wait", duration: ms, delay };
}

function hotkey(...keys) {
  return {
    type: "keyboard",
    action: "hotkey",
    keys,
    label: keys.map(k => k.charAt(0).toUpperCase() + k.slice(1)).join("+"),
    delay: 0,
  };
}

function typeText(text, delay = 0) {
  return { type: "keyboard", action: "text", text, delay };
}

const add_prompt = {
  name: "1.add_prompt",
  version: 1,
  actions: [
    wait(1000),
    click(500, 970, 200),
    wait(200),

    click(300, 970, 200),
    wait(200),
    click(300, 970, 200),
    wait(200),

    click(180, 950, 100),
    wait(200),
    click(180, 950, 100),
    wait(200),
    hotkey("ctrl", "v"),
    wait(900),

    click(850, 950, 200),
    wait(200),
    hotkey("enter"),
    wait(200),
    hotkey("enter"),

    wait(20000),

    wait(100),
    click(940, 650, 200),
    wait(100),

    hotkey("end"),
    wait(100),
    hotkey("end"),
    wait(100),
    hotkey("end"),
    wait(100),
  ],
};

const download_image = {
  name: "2.download_image",
  version: 1,

  actions: [
    wait(600),                          // wait for save dialog to fully close
    hotkey("escape"),
    wait(400),

    click(940, 650, 200),
    hotkey("end"),
    wait(400),
    hotkey("end"),
    hotkey("end"),

    rclick(116, 708, 200),
    wait(200),
    click(200, 776, 200),
    wait(1400),
    click(570, 590, 200),

    wait(600),                          // wait for save dialog to fully close
    hotkey("escape"),                   // dismiss any remaining overlay
    wait(1600)
  ],
};

const next = {
  name: "3.next",
  version: 1,
  actions: [
    wait(1600),
    // click(660, 970,200),
    wait(100),
  ],
};

const exit = {
  name: "4.exit",
  version: 1,
  actions: [
    // click(1077, 881),
    // wait(400),
    // hotkey("end"),
    wait(400),
  ],
};

const wait_macro = {
  name: "5.wait",
  version: 1,
  actions: [
    wait(10000),
  ],
};

module.exports = {
  add_prompt,
  download_image,
  next,
  exit,
  wait: wait_macro,

  helpers: { click, rclick, wait, hotkey, typeText },
};