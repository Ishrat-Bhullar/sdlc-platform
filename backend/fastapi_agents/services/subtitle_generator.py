"""
services/subtitle_generator.py
================================
Subtitle Generator — genuinely new (no prior SRT/VTT/caption-file code
existed anywhere in the codebase, confirmed via grep). Produces downloadable
.srt/.vtt sidecar files from per-slide narration text + per-slide audio
duration (both already computed by existing callers — narration text from
each slide's speaker_notes/narration field, duration via
video_pipeline_local._get_audio_duration or the per-slide TTS loop in
VideoGenerationPipeline).

Phase 1 scope: one subtitle cue per slide, using cumulative start/end
timestamps — not re-split into multiple timed cues per slide, since that
needs word-level timing data none of the TTS engines in this codebase
expose. This is additive to (not a replacement for) the existing burned
caption-band behavior in video_pipeline_local.py's _draw_captions, which
stays completely unchanged.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class SubtitleCue:
    index: int
    start_seconds: float
    end_seconds: float
    text: str


def build_cues(slide_texts: list[str], slide_durations: list[float]) -> list[SubtitleCue]:
    """One cue per slide, in cumulative timeline order. Raises ValueError if
    the two lists don't line up — callers already have both lists in lockstep
    (same per-slide loop that generates narration and renders images)."""
    if len(slide_texts) != len(slide_durations):
        raise ValueError(
            f"slide_texts ({len(slide_texts)}) and slide_durations "
            f"({len(slide_durations)}) count mismatch"
        )
    cues: list[SubtitleCue] = []
    cursor = 0.0
    for i, (text, duration) in enumerate(zip(slide_texts, slide_durations)):
        text = (text or "").strip()
        if not text:
            cursor += max(0.0, duration)
            continue
        start = cursor
        end = cursor + max(0.5, duration)
        cues.append(SubtitleCue(index=len(cues) + 1, start_seconds=start, end_seconds=end, text=text))
        cursor = end
    return cues


def _format_srt_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rem_ms = divmod(total_ms, 3_600_000)
    minutes, rem_ms = divmod(rem_ms, 60_000)
    secs, ms = divmod(rem_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def _format_vtt_timestamp(seconds: float) -> str:
    total_ms = max(0, round(seconds * 1000))
    hours, rem_ms = divmod(total_ms, 3_600_000)
    minutes, rem_ms = divmod(rem_ms, 60_000)
    secs, ms = divmod(rem_ms, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def to_srt(cues: list[SubtitleCue]) -> str:
    blocks = []
    for cue in cues:
        blocks.append(
            f"{cue.index}\n"
            f"{_format_srt_timestamp(cue.start_seconds)} --> {_format_srt_timestamp(cue.end_seconds)}\n"
            f"{cue.text}\n"
        )
    return "\n".join(blocks)


def to_vtt(cues: list[SubtitleCue]) -> str:
    blocks = ["WEBVTT", ""]
    for cue in cues:
        blocks.append(
            f"{_format_vtt_timestamp(cue.start_seconds)} --> {_format_vtt_timestamp(cue.end_seconds)}\n"
            f"{cue.text}\n"
        )
    return "\n".join(blocks)


def write_subtitle_files(cues: list[SubtitleCue], out_dir: Path, base_name: str) -> tuple[Path, Path]:
    """Writes {base_name}.srt and {base_name}.vtt to out_dir, returns (srt_path, vtt_path)."""
    out_dir.mkdir(parents=True, exist_ok=True)
    srt_path = out_dir / f"{base_name}.srt"
    vtt_path = out_dir / f"{base_name}.vtt"
    srt_path.write_text(to_srt(cues), encoding="utf-8")
    vtt_path.write_text(to_vtt(cues), encoding="utf-8")
    return srt_path, vtt_path
