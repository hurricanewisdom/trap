"""
Audio work the bot shells out to, because neither of these has a node binding
worth having: transcription through faster-whisper and song identification
through shazamio.

Run from the virtualenv at /opt/trap-py, never the system python, which is
missing both and would fight Debian's packages if it were made to have them.

    audio.py transcribe <file>
    audio.py identify <file>

One json object on stdout either way, so the caller never parses prose.
"""

import asyncio
import json
import sys


def fail(reason: str) -> None:
    print(json.dumps({"ok": False, "error": reason}))
    sys.exit(0)


def transcribe(path: str) -> None:
    from faster_whisper import WhisperModel

    # int8 on cpu: this box has no gpu, and the quantised small model is the
    # point where accuracy stops improving faster than it costs.
    model = WhisperModel("small", device="cpu", compute_type="int8", num_workers=4)
    # No voice-activity filter. It is tuned for speech over silence and throws
    # away sung vocals over music entirely -- a song comes back as zero segments
    # and no error, which reads as "nothing was said" rather than as a setting.
    segments, info = model.transcribe(path, beam_size=5)

    said = []
    for segment in segments:
        said.append({"at": round(segment.start, 1), "text": segment.text.strip()})
        # A very long recording would otherwise build a reply nothing can post.
        if len(said) >= 400:
            break

    print(
        json.dumps(
            {
                "ok": True,
                "language": info.language,
                "confidence": round(info.language_probability, 2),
                "seconds": round(info.duration, 1),
                "segments": said,
                "text": " ".join(one["text"] for one in said).strip(),
            }
        )
    )


def identify(path: str) -> None:
    from shazamio import Shazam

    async def ask():
        return await Shazam().recognize(path)

    found = asyncio.run(ask())
    track = (found or {}).get("track")
    if not track:
        print(json.dumps({"ok": True, "found": False}))
        return

    sections = track.get("sections") or []
    facts = {}
    for section in sections:
        for row in section.get("metadata") or []:
            if row.get("title") and row.get("text"):
                facts[row["title"]] = row["text"]

    images = track.get("images") or {}
    print(
        json.dumps(
            {
                "ok": True,
                "found": True,
                "title": track.get("title"),
                "artist": track.get("subtitle"),
                "cover": images.get("coverarthq") or images.get("coverart"),
                "url": track.get("url"),
                "facts": facts,
                "genre": (track.get("genres") or {}).get("primary"),
            }
        )
    )


def main() -> None:
    if len(sys.argv) < 3:
        fail("usage: audio.py <transcribe|identify> <file>")

    mode, path = sys.argv[1], sys.argv[2]
    try:
        if mode == "transcribe":
            transcribe(path)
        elif mode == "identify":
            identify(path)
        else:
            fail(f"unknown mode {mode}")
    except Exception as err:  # noqa: BLE001 - the caller wants a reason, not a trace
        fail(f"{type(err).__name__}: {err}"[:300])


if __name__ == "__main__":
    main()
