# wifi-to-midi

Turn any phone or tablet on your WiFi into a MIDI controller for your Mac.

The app creates a **virtual MIDI device** called **"WiFi MIDI"** on your MacBook (it shows
up in Ableton Live, Logic Pro, GarageBand, Bitwig and so on, just like a USB controller) and
serves a web page you can open on any device on the same network.

In the web page you build your own control surface:

- **Note trigger**: a pad that sends a note on a chosen channel.
  - *Hold*: note on while you press, note off when you let go.
  - *Toggle*: tap once for note on, tap again for note off.
  - Velocity can be set for each pad.
- **CC level**: a fader that sends values 0–127 for a chosen CC number and channel,
  shown vertically or horizontally.

Controls are saved in `controls.json` and stay in sync across every connected device.

## Install and run

The code is on the `claude/magical-cannon-v41b23` branch until it is merged into `main`.

### macOS

```bash
# 1. Homebrew (skip if you have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
# 2. Node.js and git
brew install node git
# 3. Get the app and its dependencies
git clone -b claude/magical-cannon-v41b23 https://github.com/jski7/wifi-to-midi.git
cd wifi-to-midi
npm install
# 4. Start
npm start
```

Next time, double-click **`start.command`** in Finder (right-click → **Open** the first time
if macOS blocks it). When macOS asks whether Node may accept incoming network connections,
click **Allow**.

### Windows

Windows cannot create virtual MIDI devices, so install the free
[loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html), open it, type
`WiFi MIDI` as the port name and click **+**. Keep loopMIDI running. Then in PowerShell:

```powershell
winget install OpenJS.NodeJS.LTS Git.Git
# close and reopen PowerShell so node and git are found
git clone -b claude/magical-cannon-v41b23 https://github.com/jski7/wifi-to-midi.git
cd wifi-to-midi
npm install
npm start
```

Next time, double-click **`start.bat`**. Allow Node through Windows Firewall on
**private networks** when asked. In your DAW, choose **WiFi MIDI** (the loopMIDI port) as input.

### Linux

```bash
sudo apt install nodejs npm git     # Node 18+ required
git clone -b claude/magical-cannon-v41b23 https://github.com/jski7/wifi-to-midi.git
cd wifi-to-midi && npm install && npm start
```

A virtual ALSA MIDI port named "WiFi MIDI" is created.

### Open the controller

The terminal prints the addresses to open, for example:

```
🎹 Virtual MIDI device "WiFi MIDI" created.
📡 WiFi to MIDI is running. Open on your phone (same WiFi):
   http://192.168.1.23:8080
```

Open one of those URLs on your phone. On iPhone you can tap **Share → Add to Home Screen** to
get a full-screen app.

## Using it

1. Tap **Edit**, then **+ Add**.
2. Pick **Note trigger** or **CC level**, the MIDI channel (1–16), and the note or CC number.
   The note name (middle C = 60 = C3) or common CC name is shown as you type.
3. Tap **Save**. Add as many controls as you like.
4. In edit mode, tap a control to change or delete it, or use ◀ ▶ to reorder.
5. Tap **Done** and play.

In your DAW, enable **WiFi MIDI** as a MIDI input (in Ableton: *Settings → Link, Tempo & MIDI*,
turn on *Track* and *Remote* for "WiFi MIDI"), then MIDI-map the pads and faders.

## Options

Set these environment variables when starting:

| Variable      | Default         | Meaning                          |
|---------------|-----------------|----------------------------------|
| `PORT`        | `8080`          | Web server port                  |
| `MIDI_NAME`   | `WiFi MIDI`     | Name of the virtual MIDI device  |
| `CONFIG_FILE` | `controls.json` | Where controls are saved         |

Example: `MIDI_NAME="Phone Pads" PORT=9000 npm start`

## Notes

- If a phone disconnects while a pad is held, the server sends note off so notes don't hang.
- If the virtual MIDI device can't be created (for example on a machine with no MIDI system),
  the app still runs in **log-only** mode and prints MIDI messages to the terminal. The web
  page shows a "log only" badge in that case.
- There is no login: anyone on your network who opens the page can send MIDI. Use it on
  networks you trust.
