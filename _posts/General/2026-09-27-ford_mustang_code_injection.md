---
title: "Ford Mustang Shelby GT500 Code Injection"
classes: wide
header:
  teaser: /assets/images/1DsC3.jpg
ribbon: green
description: "Ford Mustang Shelby GT500 HTML Injection in the SYNC Infotainment via Bluetooth Device Name"
categories:
  - General
tags:
  - General
  - pentest
  - pentesting
  - car
  - cars
  - ford
  - mustang
  - CAN
  - Car Hacking
toc: true
---

# Introduction

Hello again! This one is from a completely different battlefield: **car hacking**. Modern cars are rolling computers — the infotainment unit in front of the driver is a full computer running its own `OS`, rendering its own `UI`, And talking to the outside world over `Bluetooth`, `Wi-Fi` and `USB`. And just like any other computer, If it renders attacker-controlled input without sanitizing it... it breaks.

This is a vulnerability I found in the **Ford Mustang Shelby GT500 (V8)** infotainment system (`Ford SYNC`): the **Bluetooth device name** of any phone trying to pair is rendered inside the `SYNC` pairing dialog **without sanitization** — which means an attacker can inject `HTML` into the car's dashboard screen, Just by renaming their phone.

# The Story

It started the way most of these finds start — sitting in a rented `Ford Mustang Shelby GT500`, Bored, Poking at things. The `SYNC` unit was waiting for a `Bluetooth` device to pair, And my phone was sitting right there with its `Bluetooth` settings open. One thought crossed my mind: **the pairing screen displays the phone's device name on the car's screen. And car screens these days are not drawn with pixels — They are drawn with `HTML`.**

Modern infotainment units (and `Ford SYNC` is no exception) render their interfaces using web technologies. Which means every string that touches that screen — including the `Bluetooth` device name of the phone you pair — is very likely being interpolated into some `HTML` template somewhere. And if nobody sanitized that string...

So I opened my phone's `Bluetooth` settings, Renamed my device, And watched the car screen. The payload was simple — my device name (`azima`) wrapped with an attribute-breakout and a heading tag:

```
"><h1>azima</h1>
```

Breaking it down piece by piece:

| Fragment | Purpose |
|----------|---------|
| `"` | Close the `attribute="..."` the device name is interpolated into |
| `>` | Close the `HTML` tag the attribute lives in |
| `<h1>` | Inject a level-1 heading element |
| `azima` | The rendered text — my handle, Now a heading on the car's screen |
| `</h1>` | Close the injected heading |


# The Vulnerability

Now the car side. On the `SYNC` unit: **Phone** → **Bluetooth Devices** → **Select a Device to Pair** → the discovery list picks up the phone. And look at what the device list shows — the injected fragment `">` is already leaking onto the screen as raw text where the clean device name should be:

<img width="1600" height="900" alt="image" src="https://github.com/user-attachments/assets/848e8dee-da8b-4e64-8864-ff660eca215c" />


Selecting the device starts the pairing. And here is the first confirmation — the "Waiting for" dialog renders the **raw device name as text**: `"↳<h1>azima</h1>` — The tag characters visible, Sitting in the dialog as-is:

<img width="1600" height="900" alt="image" src="https://github.com/user-attachments/assets/b3afcc50-38d6-47e3-b762-5f1cbeb2c857" />


But the `PIN` confirmation dialog is where it gets interesting. Look very carefully at what the `SYNC` screen renders for the crafted device:

<img width="1600" height="900" alt="image" src="https://github.com/user-attachments/assets/091e214b-d836-440a-87cf-8d1b4a9e9648" />


Compare it with a **normal** pairing (clean device name `azima`, No payload):

Side by side, The difference is the whole vulnerability:

| | Normal (`azima`) | Crafted (`"><h1>azima</h1>`) |
|---|------------------|------------------------------|
| Device name rendering | Plain text, Inline with the dialog text | **Breakout fragment `">` rendered as raw text at the top** |
| Injected text | — | **`azima` rendered as a level-1 heading** — Bigger font, Own line, Own styling |
| Dialog layout | Standard `SYNC` layout | Layout shifted by the injected element |

That heading is not the car drawing my name in big letters out of politeness — **that is a real `<h1>` `HTML` element, Parsed and rendered by the `SYNC` UI.** The `">` at the top of the dialog is the broken-out attribute closure — The exact bytes of my payload, Interpreted as markup.

## So What Happened Under the Hood

The `SYNC` pairing dialog builds its screen from an `HTML` template, Interpolating the `Bluetooth` device name into an attribute or text node:

```html
<!-- simplified reconstruction of the pattern -->
<div class="device-name" title="azima">azima</div>
```

With the crafted name, The interpolation becomes:

```html
<div class="device-name" title=""><h1>azima</h1>">azima</div>
```

— The quote closes the attribute early, The `<h1>` opens a real element, And the parser renders attacker-controlled markup on the car's dashboard. Textbook `HTML` injection — Except the injection point is a `Bluetooth` device name And the rendering target is the screen in front of the driver.

## Impact

As demonstrated: **arbitrary `HTML` injection into the infotainment display**, Reachable by any `Bluetooth`-range device with a renameable name — No pairing required to reach the discovery list rendering, And the payload survives into the pairing flow. Where that goes:

- **UI spoofing** — attacker-controlled text and formatting rendered on the dashboard: fake dialogs, Fake warnings, Fake messages to the driver. A driver looking at a big injected heading is a driver looking away from the road.
- **Persistence** — the paired-device record keeps the crafted name in the car's storage: the injection re-renders every time the phone list or pairing state is displayed, On every connection.
- **Escalation path** — `HTML` injection into a web-rendered `UI` is one step from script execution if the runtime evaluates injected `script` or event handlers (`<img onerror=...>`-style payloads). That escalation was **not** part of this test — And it is exactly why `Ford` rated the report **Informative**: no `JS` execution demonstrated means no code-execution impact. But the injection primitive it stands on is demonstrated here.

# Reporting

Reported to `Ford` through their vulnerability reporting channel, With the full reproduction: the crafted `Bluetooth` device name, The pairing steps, And the evidence screenshots from this post.

`Ford`'s verdict: accepted as **Informative** — The injection renders attacker-controlled `HTML` on the infotainment screen, But no `JavaScript` execution was demonstrated, So it stayed below the bar for a code-execution issue. No `CVE` was assigned for this finding.

And the natural next step — pulling the `head unit`'s flash, Reversing the `SYNC` web runtime, Mapping the renderer to turn the `HTML` injection into script execution — was off the table: **the car was a rental, Not mine to disassemble**. The `head unit` stays in the car, And the deeper research stays open for whoever gets their hands on one.

# Conclusion

One renamed `Bluetooth` device, One `HTML` payload, And the `Ford Mustang Shelby GT500`'s dashboard renders attacker-controlled markup on the driver's screen. The lesson is the same one this whole series keeps repeating — **every string that reaches a renderer is an injection point**, Whether it comes from a web form, A `syscall`, Or the name of a phone passing by on `Bluetooth`. Modern car `UI`s are web `UI`s, And web `UI`s that interpolate unsanitized input get popped — Even at 70 miles per hour. The next steps (script execution, Persistence across reboots, Lateral movement into the ` head unit`'s `OS`) are the natural follow-ups — But the injection primitive demonstrated here is where every one of them starts.

## Help ?

If you got any questions or need help, You can contact me:

- [Linkedin](https://www.linkedin.com/in/zer0verflow/)
- [Twitter/X](https://x.com/AzimaZeyad)
- Email: [contact@zeyadazima.com](mailto:contact@zeyadazima.com)
- Discord: `.killer_1337` including `.`

**Tags:** [General](/tags/#general)

**Categories:** [General](/categories/#general)
