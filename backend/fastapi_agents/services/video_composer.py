"""
services/video_composer.py
============================
VideoComposer, extracted verbatim from services/video_generation_service.py
(no behavior change to .compose()) so it can be imported independently and
grow its own subtitle-burning capability without bloating the file that also
owns NarrationService/SlideRenderer. services/video_generation_service.py
keeps a one-line re-export so existing imports (e.g.
agents/presentation_video_agent.py) keep working unmodified.
"""
from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path


class VideoComposer:
    """Combines per-slide images and matching per-slide narration audio into
    a single narrated MP4 by shelling out to ffmpeg directly per slide, then
    concatenating — the same approach as the live /video/render pipeline.
    Requires a working ffmpeg + ffprobe binary on PATH."""

    def __init__(self, fps: int = 24, resolution: tuple[int, int] = (1920, 1080)):
        self.fps = fps
        self.resolution = resolution

    def compose(self, slide_images: list[Path], slide_audio: list[Path], out_path: Path) -> Path:
        clip_paths, tmp_dir = self._render_clips(slide_images, slide_audio)
        try:
            self._concat(clip_paths, out_path, extra_vf=None)
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        return out_path

    def compose_with_subtitles(
        self,
        slide_images: list[Path],
        slide_audio: list[Path],
        out_path: Path,
        srt_path: Path,
    ) -> Path:
        """Same per-slide-clip + concat pipeline as .compose(), but the final
        concat ffmpeg invocation adds a `subtitles=` filter to hard-burn
        captions from the given SRT file. Kept as a separate method (not a
        flag on .compose()) so the existing call site in
        agents/presentation_video_agent.py's VideoGenerationPipeline keeps
        working with zero changes."""
        clip_paths, tmp_dir = self._render_clips(slide_images, slide_audio)
        try:
            # ffmpeg's subtitles filter needs the path escaped for its own
            # mini filter-graph syntax (colons and backslashes are special).
            escaped = str(srt_path).replace("\\", "\\\\").replace(":", "\\:")
            self._concat(clip_paths, out_path, extra_vf=f"subtitles='{escaped}'")
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)
        return out_path

    def _render_clips(self, slide_images: list[Path], slide_audio: list[Path]) -> tuple[list[Path], Path]:
        if not slide_images:
            raise ValueError("[VideoComposer] No slide images provided")
        if len(slide_images) != len(slide_audio):
            raise ValueError(
                f"[VideoComposer] slide_images ({len(slide_images)}) and "
                f"slide_audio ({len(slide_audio)}) count mismatch"
            )

        rw, rh = self.resolution
        tmp_dir = slide_images[0].parent / f"clips_{uuid.uuid4().hex[:8]}"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        clip_paths: list[Path] = []
        try:
            for i, (img_path, audio_path) in enumerate(zip(slide_images, slide_audio)):
                clip = tmp_dir / f"slide_{i:03d}.mp4"
                subprocess.run(
                    [
                        "ffmpeg", "-y",
                        "-loop", "1", "-i", str(img_path),
                        "-i", str(audio_path),
                        "-vf", f"scale={rw}:{rh},fps={self.fps}",
                        "-c:v", "libx264", "-tune", "stillimage",
                        "-c:a", "aac", "-b:a", "192k",
                        "-pix_fmt", "yuv420p", "-shortest",
                        "-movflags", "+faststart",
                        str(clip),
                    ],
                    check=True, capture_output=True, timeout=120,
                )
                clip_paths.append(clip)
        except subprocess.CalledProcessError as exc:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            stderr = exc.stderr.decode(errors="ignore") if exc.stderr else str(exc)
            raise RuntimeError(f"[VideoComposer] ffmpeg clip encoding failed: {stderr[-800:]}") from exc
        except FileNotFoundError as exc:
            shutil.rmtree(tmp_dir, ignore_errors=True)
            raise RuntimeError(
                "[VideoComposer] ffmpeg is not installed or not on PATH — video rendering requires ffmpeg"
            ) from exc
        return clip_paths, tmp_dir

    def _concat(self, clip_paths: list[Path], out_path: Path, *, extra_vf: str | None) -> None:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_dir = clip_paths[0].parent
        list_file = tmp_dir / "concat_list.txt"
        list_file.write_text("\n".join(f"file '{c}'" for c in clip_paths))
        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0", "-i", str(list_file),
        ]
        if extra_vf:
            cmd += ["-vf", extra_vf]
        cmd += [
            "-c:v", "libx264", "-c:a", "aac",
            "-pix_fmt", "yuv420p", "-movflags", "+faststart",
            str(out_path),
        ]
        try:
            subprocess.run(cmd, check=True, capture_output=True, timeout=300)
        except subprocess.CalledProcessError as exc:
            stderr = exc.stderr.decode(errors="ignore") if exc.stderr else str(exc)
            raise RuntimeError(f"[VideoComposer] ffmpeg encoding failed: {stderr[-800:]}") from exc
        except FileNotFoundError as exc:
            raise RuntimeError(
                "[VideoComposer] ffmpeg is not installed or not on PATH — video rendering requires ffmpeg"
            ) from exc
