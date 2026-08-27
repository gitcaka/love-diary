"""Generate the original looping background theme used by the diary site."""

from array import array
from math import exp, pi, sin
from pathlib import Path
import random
import wave

SAMPLE_RATE = 16_000
TEMPO = 72
BEAT = 60 / TEMPO
BARS = 8
DURATION = BARS * 4 * BEAT + 1.6
TOTAL = int(DURATION * SAMPLE_RATE)

audio = array("f", [0.0]) * TOTAL
random.seed(77)


def frequency(midi: int) -> float:
    return 440.0 * 2 ** ((midi - 69) / 12)


def add_note(start: float, midi: int, length: float, volume: float, bell: bool = True) -> None:
    begin = int(start * SAMPLE_RATE)
    count = min(int(length * SAMPLE_RATE), TOTAL - begin)
    base = frequency(midi)
    phases = (0.0, 0.21, 0.47, 0.78)
    harmonics = ((1.0, 1.0), (2.0, 0.29), (3.01, 0.12), (4.02, 0.055)) if bell else ((1.0, 1.0), (2.0, 0.13), (0.5, 0.08), (3.0, 0.035))
    for offset in range(count):
        t = offset / SAMPLE_RATE
        attack = min(1.0, t / (0.012 if bell else 0.13))
        release = exp(-t * (2.7 if bell else 1.15))
        shimmer = sum(weight * sin(2 * pi * base * ratio * t + phases[index]) for index, (ratio, weight) in enumerate(harmonics))
        audio[begin + offset] += volume * attack * release * shimmer


chords = [
    (48, 55, 59, 64),  # Cmaj7
    (45, 52, 55, 60),  # Am7
    (41, 48, 52, 57),  # Fmaj7
    (43, 50, 55, 60),  # Gsus4
]
melodies = [
    (72, 76, 79, 76, 74, 72, 67, 71),
    (72, 76, 81, 79, 76, 72, 69, 72),
    (69, 72, 76, 72, 69, 67, 64, 67),
    (67, 71, 74, 72, 71, 67, 64, 67),
]

for bar in range(BARS):
    bar_start = bar * 4 * BEAT
    chord = chords[bar % len(chords)]
    melody = melodies[bar % len(melodies)]
    # A warm, quiet pad under the music-box melody.
    for note in chord:
        add_note(bar_start, note, 4.25 * BEAT, 0.021, bell=False)
    for step, note in enumerate(melody):
        human = random.uniform(-0.012, 0.012)
        add_note(bar_start + step * 0.5 * BEAT + human, note, 1.45 * BEAT, 0.078, bell=True)
    # One small high note at the end of every second bar gives it a diary-like sparkle.
    if bar % 2 == 1:
        add_note(bar_start + 3.5 * BEAT, melody[-2] + 12, 1.2 * BEAT, 0.033, bell=True)

# Gentle room echoes; work backwards so each tap is based on the dry mix.
dry = array("f", audio)
for delay_seconds, amount in ((0.19, 0.16), (0.37, 0.10), (0.73, 0.055)):
    delay = int(delay_seconds * SAMPLE_RATE)
    for index in range(delay, TOTAL):
        audio[index] += dry[index - delay] * amount

# Fade the opening and tail to silence so HTMLAudioElement.loop has no click.
fade = int(0.65 * SAMPLE_RATE)
for index in range(fade):
    audio[index] *= index / fade
    audio[TOTAL - 1 - index] *= index / fade

peak = max(abs(value) for value in audio) or 1.0
gain = 0.72 / peak
pcm = array("h", (max(-32767, min(32767, int(value * gain * 32767))) for value in audio))

target = Path(__file__).resolve().parents[1] / "public" / "bg.wav"
with wave.open(str(target), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(SAMPLE_RATE)
    output.writeframes(pcm.tobytes())

print(f"Wrote {target} ({DURATION:.1f}s, {target.stat().st_size} bytes)")
