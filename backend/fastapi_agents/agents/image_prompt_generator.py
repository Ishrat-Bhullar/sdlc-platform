"""
image_prompt_generator.py
============================
Image Prompt Generator — deterministic (no extra LLM call) keyword/category
to prompt-template lookup, the same pattern as design_engine.py's
_ICON_HINTS. Decides BOTH what prompt to generate and whether to generate
one at all (explicit allow/skip lists — "generate images only when
beneficial").

Categories reuse theme_engine.NARRATIVE_ARC's existing vocabulary (the same
category names the Storytelling/Scene Planner agents already produce) so no
new taxonomy needs to be threaded through the pipeline.
"""
from __future__ import annotations

from .. import theme_engine as TE

# ---------------------------------------------------------------------------
# Generate list — matches the user's explicit list exactly. Anything not in
# here (or in _SKIP_LAYOUTS/_SKIP_CATEGORIES below) simply gets no image.
# ---------------------------------------------------------------------------
_GENERATE_CATEGORIES = {
    "title", "section", "closing", "conclusion",
    "problem_statement", "existing_challenges",
    "proposed_solution", "why_this_solution",
    "architecture", "agent_workflow",
    "future_scope", "roi", "business_benefits",  # roadmap/timeline-adjacent
}

# Explicit skip list — dense technical tables, DB schemas, code snippets
# never get an image regardless of category (never beneficial, per the ask).
_SKIP_LAYOUTS = {"table", "chart"}
_SKIP_CATEGORIES = {"database", "db_schema", "technology_stack", "deliverables"}
_CODE_MARKERS = ("```", "def ", "class ", "SELECT ", "function(", "import ")

_PROMPT_TEMPLATES: dict[str, str] = {
    "title": "modern enterprise digital transformation, abstract corporate hero illustration, isometric, {palette} palette, no text, no words",
    "section": "abstract enterprise consulting illustration, geometric, {palette} palette, no text, no words",
    "problem_statement": "modern enterprise struggling with legacy software, digital transformation challenge, enterprise consulting illustration, isometric, {palette} palette, no text, no words",
    "existing_challenges": "frustrated enterprise team facing outdated technology, consulting illustration, {palette} palette, no text, no words",
    "proposed_solution": "modern software solution launch, enterprise consulting illustration, isometric, {palette} palette, no text, no words",
    "why_this_solution": "enterprise decision making, strategic technology choice, consulting illustration, {palette} palette, no text, no words",
    "architecture": "isometric enterprise cloud architecture with AI agents, APIs, databases, containers, enterprise infographic style, {palette} palette, no text, no words",
    "agent_workflow": "professional workflow diagram illustration, connected automated process steps, enterprise infographic, {palette} palette, no text, no words",
    "future_scope": "futuristic enterprise technology roadmap, growth and expansion, consulting illustration, {palette} palette, no text, no words",
    "roi": "business growth and value chart illustration, enterprise consulting, {palette} palette, no text, no words",
    "business_benefits": "enterprise success and productivity illustration, consulting, {palette} palette, no text, no words",
    "closing": "professional enterprise illustration, partnership and success, {palette} palette, no text, no words",
    "conclusion": "professional enterprise illustration, partnership and success, {palette} palette, no text, no words",
}

# Industry-specific templates, detected by keyword regardless of the slide's
# narrative category — an industry-use-case slide about healthcare gets the
# healthcare template even if its category is "proposed_solution".
_INDUSTRY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "government": ("government", "public sector", "governance", "citizen", "municipal"),
    "healthcare": ("healthcare", "hospital", "patient", "clinical", "medical"),
    "banking": ("banking", "fintech", "financial", "payments", "loan"),
    "cybersecurity": ("cybersecurity", "security operations", "threat", "soc ", "incident response"),
    "manufacturing": ("manufacturing", "factory", "industry 4.0", "assembly line", "supply chain"),
    "agriculture": ("agriculture", "farming", "crop", "precision farming", "irrigation"),
}
_INDUSTRY_TEMPLATES: dict[str, str] = {
    "government": "digital governance dashboard, isometric illustration, {palette} palette, no text, no words",
    "healthcare": "AI healthcare platform illustration, clinical technology, {palette} palette, no text, no words",
    "banking": "modern fintech dashboard illustration, {palette} palette, no text, no words",
    "cybersecurity": "SOC operations center illustration, security monitoring, {palette} palette, no text, no words",
    "manufacturing": "Industry 4.0 smart factory illustration, {palette} palette, no text, no words",
    "agriculture": "precision farming illustration, drone and sensors, {palette} palette, no text, no words",
}


def _looks_like_code(text: str) -> bool:
    return any(marker in text for marker in _CODE_MARKERS)


def _detect_industry(text: str) -> str | None:
    lowered = text.lower()
    for industry, keywords in _INDUSTRY_KEYWORDS.items():
        if any(kw in lowered for kw in keywords):
            return industry
    return None


def build_image_prompt(
    slide_title: str,
    slide_type_hint: str,
    theme_id: str,
    *,
    slide_layout: str | None = None,
    slide_text: str = "",
) -> str | None:
    """Returns a ready-to-send image prompt, or None to skip image
    generation for this slide entirely. `slide_type_hint` is the narrative
    category (title/architecture/problem_statement/etc. — the same
    vocabulary theme_engine.NARRATIVE_ARC and the Scene Planner already use);
    `slide_layout` is the pptx_builder layout key (table/chart/items/...);
    `slide_text` is the slide's bullets/body text, used only for industry-
    keyword and code-content detection."""
    category = (slide_type_hint or "").strip().lower()
    layout = (slide_layout or "").strip().lower()
    combined_text = f"{slide_title} {slide_text}"

    if layout in _SKIP_LAYOUTS or category in _SKIP_CATEGORIES:
        return None
    if _looks_like_code(slide_text):
        return None

    theme = TE.get_theme(theme_id)
    palette = theme.get("image_palette", "professional enterprise")

    industry = _detect_industry(combined_text)
    if industry:
        return _INDUSTRY_TEMPLATES[industry].format(palette=palette)

    if category not in _GENERATE_CATEGORIES:
        return None

    template = _PROMPT_TEMPLATES.get(category)
    if not template:
        return None
    return template.format(palette=palette)
