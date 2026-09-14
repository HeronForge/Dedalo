# Showcase example — EVC-22 AC charge controller (Voltaria Energy S.r.l.)

Invented product for the rich demo. The generated pictures live in `images/` as WebP, under the
names given below; `build/demo-wallbox.mjs` reads them from there (see `README.md` here).

## Document outline

Test stages (in sequence order):
1. Set-up and dielectric strength — hipot 2.5 kV between mains and PE / SELV, exclusive with every other stage.
2. Supply and idle — quiescent current, 3V3 / 12V rails on test pads, firmware version over the service UART.
3. Control Pilot (IEC 61851-1) — PWM frequency and levels, duty ↔ max current, state transitions A→B→C, state E fault.
4. Proximity Pilot — cable capability by resistor: 13 / 20 / 32 A, unplugged.
5. Contactor drive and mirror contact — coil current, feedback contact, welded-contact simulation → fault.
6. Residual current monitor — 6 mA DC and 30 mA AC injection, trip time.
7. Energy metering — Modbus RTU reading vs bench power analyser, accuracy.
8. Communications — Ethernet link, Wi-Fi association, OCPP heartbeat to the bench simulator.
9. HMI — LED ring colours (colorimeter), buzzer level (microphone), tamper switch (actuator).
10. RFID — test tag UID read at 10 mm and at the guaranteed 30 mm (the EVC-7 S variant removes it).
11. Temperature — NTC vs PT100 reference, over-temperature derating with a decade box.
12. Diagnostics and close-out — fault memory, serial number written, power down and discharge.

Setup routines: Power up (isolated variac), Power down and discharge, Pilot state B.

Variants: EVC-7 (single phase 7.4 kW, one relay, no RFID), EVC-22 (base, three phase 22 kW),
EVC-22 Pro (RFID + display + 4G modem: extra communications tests).

Pictures and what gets marked on them:
- `pcb-top.*` — X1 mains, X2 contactor, X3 pilot/PP, X4 RS-485, X5 Ethernet, service header, relay, NTC connector, test pads.
- `pcb-bottom.*` — bed-of-nails pads.
- `front.*` — LED ring, RFID area, buzzer grille, Type 2 socket, display (Pro).
- `terminals.*` — L1 L2 L3 N PE terminals, residual current toroid, cable gland.
- `bench.*` — bench overview, no markers (description section).
- `logo.*` — optional, can be drawn as SVG.

## Image prompts

The first four were generated and are in `images/`; the bench picture and the logo were not
(the logo is drawn as an SVG in the builder).

Common prefix (paste before every prompt so the set looks consistent):

> Photorealistic product photography for a technical manual. Top-down orthographic view, flat
> even studio lighting, no perspective distortion, no hands, no cables dangling, no reflections,
> plain light grey seamless background. Sharp focus everywhere. Square 1:1, at least 1024 px.

### 1 — pcb-top (essential)
A modern industrial control PCB, about 160 x 120 mm, dark blue solder mask with white silkscreen.
Along the left edge a row of large green screw terminal blocks; along the right edge an RJ45
Ethernet jack, a 3-pin RS-485 pluggable terminal and a small 4-pin pilot connector. In the
upper area two black power relays side by side and a small toroidal current transformer. In
the centre a microcontroller in a QFP package with a Wi-Fi module with a printed antenna next
to it. Lower right a 6-pin unpopulated programming header and a 2-pin white JST connector for a
temperature sensor. Several round gold test pads scattered on the board. Silkscreen reference
designators like X1, X2, X3, X4, X5, K1, K2, TP1, J1 printed in clean white sans-serif text.
Four mounting holes in the corners.

### 2 — pcb-bottom (recommended)
The solder side of the same industrial control PCB, dark blue solder mask, seen from below:
mostly flat with tin-plated through-hole solder joints of the terminal blocks and relays on
the edges, and a regular grid of about twenty round gold-plated test pads 2 mm in diameter
with small white silkscreen labels TP1 to TP20 beside them. Wide copper power traces visible
under the mask near the terminals. Four mounting holes in the corners. Clean, unused board.

### 3 — front (essential)
The front face of a wall-mounted electric vehicle AC charging station (wallbox), white and
anthracite plastic enclosure, roughly 300 x 200 mm portrait. A circular RGB LED ring light
glowing soft blue in the upper centre; below it a small flat area with an embossed contactless
card symbol for an RFID reader; a small monochrome display window with a status text; a row of
tiny holes for a buzzer; at the bottom a Type 2 charging socket with its hinged cover open.
Seen straight on, mounted on a plain wall, no cable plugged in, no logo text.

### 4 — terminals (essential)
The open wiring compartment of a wall-mounted EV charging station, seen straight on with the
front cover removed: a black plastic base with a row of five large screw terminals labelled
L1, L2, L3, N and green-yellow PE at the bottom, a black residual current sensing toroid with
the three phase wires passing through it, a small DIN-rail with a compact energy meter with a
tiny LCD, a cable gland at the bottom edge, and a ribbon cable going to the control board
partially visible at the top. Clean installation, no dust, no hands.

### 5 — bench (nice to have)
An electronics production end-of-line test bench: a bed-of-nails test fixture with a pneumatic
press holding a dark blue control PCB, next to it a 19-inch rack with a programmable AC power
source, a digital multimeter, an oscilloscope showing a square wave, and a PC monitor with a
test sequence table with green PASS rows. An RFID test card on a small holder and a colorimeter
probe on an articulated arm pointed at a wallbox front panel. Bright industrial lab, no people.
(For this one use a slight three-quarter perspective instead of top-down.)

### 6 — logo (optional; I can draw an SVG instead)
A flat vector-style logo for an electric-mobility company called "VOLTARIA": a stylised
lightning bolt merging into a charging plug, deep teal and lime green, wordmark VOLTARIA in a
geometric sans-serif below, on a plain white background, no gradients, no shadows.
