# Showcase pictures

The photographs `dist/wallbox.html` embeds, as `build/demo-wallbox.mjs` reads them: WebP,
longest side at most 1600 px, quality 82 — what the tool itself stores when a picture is
uploaded, so the built file is the file the tool would have written.

They were generated from the prompts in `prompts.md` and converted with Pillow:

```
python -c "from PIL import Image; Image.open('src.png').convert('RGB').save('pcb-top.webp', 'WEBP', quality=82, method=6)"
```

| File | Shows | Marked with |
|---|---|---|
| `pcb-top.webp` | controller board, component side | terminals of X1, connectors X2 to X6, header J1, pads TP1 to TP4 |
| `pcb-bottom.webp` | controller board, solder side | the bed of nails pads |
| `front.webp` | front panel of the wallbox | LED ring, RFID reader, display, buzzer, Type 2 socket contacts |
| `terminals.webp` | wiring compartment | mains terminals, residual current toroid, energy meter, panel ribbon |

The marker coordinates live in the builder, as fractions of the picture: replacing a picture
with one of a different layout means moving them.
