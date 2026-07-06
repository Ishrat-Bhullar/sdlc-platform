"""
persona_engine.py
==================
Presenter Persona Engine — single source of truth for avatar/presenter
identity, replacing what was previously just a flat list of display strings
in the frontend (VideoGenerationWorkspace.tsx's AVATARS array and
AvatarSelector.tsx's PRESETS array, which use two different id conventions —
slugged ids in one, Title Case display strings in the other). This module is
tolerant of both, mirroring theme_engine.get_theme()'s alias-tolerant lookup
pattern, so neither frontend component needs to change its existing prop
shape (`{mode, value}`) — only the backend gains a real profile per persona.

Each PersonaProfile is consumed by:
  - avatar_script_agent.py — tone/default_emotion, so narration stays
    consistent across the whole presentation instead of drifting slide to
    slide.
  - video_pipeline_local.py / avatar_provider.py — voice_id + avatar_image_ref,
    so the rendered face/voice matches the selected persona.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class PersonaProfile:
    id: str
    display_name: str
    category: str
    voice_id: str = "samantha"
    tone: str = "professional"
    default_emotion: str = "confident"  # must match video_pipeline_local.EMOTION_PRESETS keys
    avatar_image_ref: str = ""          # local asset path or provider-specific reference; "" = use provider default
    scene_suggestion: str = "Office"
    aliases: tuple[str, ...] = field(default_factory=tuple)


# Seeded from the existing frontend catalogs (VideoGenerationWorkspace.tsx's
# 22 AVATARS + AvatarSelector.tsx's 23 PRESETS — union, deduplicated) plus the
# personas explicitly named in the redesign brief that weren't already
# present (construction_worker, healthcare_worker, government_mascot,
# enterprise_ai_assistant).
_PERSONAS: list[PersonaProfile] = [
    PersonaProfile("professional_male", "Professional Male", "corporate",
                   voice_id="alex", tone="professional", default_emotion="confident",
                   aliases=("professional male",)),
    PersonaProfile("professional_female", "Professional Female", "corporate",
                   voice_id="samantha", tone="professional", default_emotion="confident",
                   aliases=("professional female",)),
    PersonaProfile("ceo", "CEO", "corporate", voice_id="alex",
                   tone="authoritative", default_emotion="authoritative"),
    PersonaProfile("executive", "Executive", "corporate", voice_id="alex",
                   tone="authoritative", default_emotion="authoritative",
                   aliases=("exec",)),
    PersonaProfile("engineer", "Engineer", "technical", voice_id="daniel",
                   tone="technical", default_emotion="calm"),
    PersonaProfile("doctor", "Doctor", "healthcare", voice_id="victoria",
                   tone="warm", default_emotion="warm", scene_suggestion="Clinic"),
    PersonaProfile("healthcare_worker", "Healthcare Worker", "healthcare", voice_id="victoria",
                   tone="warm", default_emotion="warm", scene_suggestion="Hospital",
                   aliases=("nurse", "healthcare professional")),
    PersonaProfile("teacher", "Teacher", "education", voice_id="karen",
                   tone="warm", default_emotion="warm", scene_suggestion="Classroom"),
    PersonaProfile("scientist", "Scientist", "technical", voice_id="daniel",
                   tone="technical", default_emotion="calm", scene_suggestion="Laboratory"),
    PersonaProfile("lawyer", "Lawyer", "corporate", voice_id="tom",
                   tone="authoritative", default_emotion="authoritative"),
    PersonaProfile("student", "Student", "education", voice_id="alex",
                   tone="energetic", default_emotion="energetic"),
    PersonaProfile("police", "Police Officer", "public_service", voice_id="tom",
                   tone="authoritative", default_emotion="authoritative",
                   aliases=("police officer",)),
    PersonaProfile("govt_officer", "Govt. Officer", "government", voice_id="daniel",
                   tone="formal", default_emotion="professional", scene_suggestion="Government Office",
                   aliases=("government officer",)),
    PersonaProfile("government_mascot", "Government Mascot", "government", voice_id="tom",
                   tone="warm", default_emotion="warm", scene_suggestion="Government Office"),
    PersonaProfile("news_anchor", "News Anchor", "media", voice_id="victoria",
                   tone="professional", default_emotion="confident", scene_suggestion="Studio"),
    PersonaProfile("minister", "Minister", "government", voice_id="daniel",
                   tone="formal", default_emotion="authoritative", scene_suggestion="Government Office"),
    PersonaProfile("chief_minister", "Chief Minister", "government", voice_id="daniel",
                   tone="formal", default_emotion="authoritative", scene_suggestion="Government Office"),
    PersonaProfile("prime_minister", "Prime Minister", "government", voice_id="tom",
                   tone="formal", default_emotion="authoritative", scene_suggestion="Government Office"),
    PersonaProfile("farmer", "Farmer", "rural", voice_id="tom",
                   tone="warm", default_emotion="warm", scene_suggestion="Farm"),
    PersonaProfile("village_woman", "Village Woman", "rural", voice_id="karen",
                   tone="warm", default_emotion="warm", scene_suggestion="Village"),
    PersonaProfile("construction_worker", "Construction Worker", "industrial", voice_id="tom",
                   tone="energetic", default_emotion="energetic", scene_suggestion="Construction Site"),
    PersonaProfile("factory_worker", "Factory Worker", "industrial", voice_id="alex",
                   tone="energetic", default_emotion="energetic", scene_suggestion="Factory"),
    PersonaProfile("poor_family", "Poor Family", "rural", voice_id="karen",
                   tone="warm", default_emotion="warm"),
    PersonaProfile("child", "Child", "general", voice_id="samantha",
                   tone="energetic", default_emotion="energetic"),
    PersonaProfile("cartoon", "Cartoon", "animated", voice_id="samantha",
                   tone="playful", default_emotion="energetic"),
    PersonaProfile("cartoon_assistant", "Cartoon Assistant", "animated", voice_id="samantha",
                   tone="playful", default_emotion="energetic",
                   aliases=("cartoon character",)),
    PersonaProfile("3d_avatar", "3D Avatar", "animated", voice_id="daniel",
                   tone="professional", default_emotion="confident",
                   aliases=("3d avatar",)),
    PersonaProfile("enterprise_ai_assistant", "Enterprise AI Assistant", "ai", voice_id="samantha",
                   tone="professional", default_emotion="professional",
                   aliases=("ai assistant", "enterprise assistant")),
]

PERSONA_LIBRARY: dict[str, PersonaProfile] = {p.id: p for p in _PERSONAS}

_DEFAULT_PERSONA_ID = "enterprise_ai_assistant"


def _slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.strip().lower()).strip("_")


def get_persona(persona_id: str | None) -> PersonaProfile:
    """Tolerant lookup — accepts a slug id ('farmer'), a Title Case display
    string ('Farmer'), or one of a persona's registered aliases. Falls back
    to a sensible default (Enterprise AI Assistant) for unknown/blank input,
    mirroring theme_engine.get_theme()'s never-fail contract."""
    if not persona_id:
        return PERSONA_LIBRARY[_DEFAULT_PERSONA_ID]
    slug = _slugify(str(persona_id))
    if slug in PERSONA_LIBRARY:
        return PERSONA_LIBRARY[slug]
    for persona in _PERSONAS:
        if slug in (_slugify(a) for a in persona.aliases):
            return persona
    return PERSONA_LIBRARY[_DEFAULT_PERSONA_ID]


def list_personas() -> list[PersonaProfile]:
    return list(_PERSONAS)
