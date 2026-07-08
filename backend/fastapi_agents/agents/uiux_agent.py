from __future__ import annotations

import json
import os
from pydantic import BaseModel
from .llm_service import LLMService

try:
    from google import genai
    from google.genai import types
except ImportError:
    genai = None


from .llm_service import LLMService

try:
    from ..models import DEMO_MODE
except ImportError:
    DEMO_MODE = False

# ---------------------------------

class Screen(BaseModel):
    name: str = ""
    purpose: str = ""
    type: str = "page"  # page, modal, drawer, etc.
    components: list[str] = []


class UserFlow(BaseModel):
    name: str = ""
    steps: list[str] = []
    screens: list[str] = []


class Wireframe(BaseModel):
    screen: str = ""
    layout: str = ""
    description: str = ""


class ComponentRecommendation(BaseModel):
    name: str = ""
    type: str = ""
    library: str = ""
    rationale: str = ""


class TypographyScale(BaseModel):
    fontFamily: str = "Inter, system-ui, sans-serif"
    headingFont: str = "Inter, system-ui, sans-serif"
    scale: dict[str, str] = {}
    rationale: str = ""


class SpacingSystem(BaseModel):
    baseUnit: str = "8px"
    scale: list[str] = []
    rationale: str = ""


class ColorToken(BaseModel):
    name: str = ""
    hex: str = ""
    usage: str = ""


class ColorPalette(BaseModel):
    primary: list[ColorToken] = []
    neutral: list[ColorToken] = []
    semantic: list[ColorToken] = []
    rationale: str = ""


class DesignSystemComponent(BaseModel):
    name: str = ""
    states: list[str] = []
    variants: list[str] = []
    accessibility_notes: str = ""


class ResponsiveBreakpoint(BaseModel):
    name: str = ""
    min_width: str = ""
    layout_behavior: str = ""


class AccessibilityRequirement(BaseModel):
    guideline: str = ""
    applies_to: str = ""
    implementation: str = ""


class DesignSystem(BaseModel):
    typography: TypographyScale = TypographyScale()
    spacing: SpacingSystem = SpacingSystem()
    colorPalette: ColorPalette = ColorPalette()
    components: list[DesignSystemComponent] = []
    responsiveBreakpoints: list[ResponsiveBreakpoint] = []
    accessibility: list[AccessibilityRequirement] = []
    designPrinciples: list[str] = []


class UIUXDesignOutput(BaseModel):
    screens: list[Screen] = []
    userFlows: list[UserFlow] = []
    wireframes: list[Wireframe] = []
    componentRecommendations: list[ComponentRecommendation] = []
    uxRecommendations: list[str] = []
    designSystem: DesignSystem = DesignSystem()
    ui_spec: dict = {}  # Added for Gemini React UI Spec


# ---------------------------------
# System Prompt (loaded from prompts folder)
# ---------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def load_prompt(file_name: str) -> str:
    prompt_path = os.path.join(BASE_DIR, "prompts", file_name)
    if not os.path.exists(prompt_path):
        raise FileNotFoundError(f"Required agent system instructions missing: {prompt_path}")
    with open(prompt_path, "r", encoding="utf-8") as file:
        return file.read()


UIUX_AGENT_SYSTEM_PROMPT = load_prompt("uiux_agent_prompt.txt")


# ---------------------------------
# Prompt Builder
# ---------------------------------

def build_uiux_prompt(
    project_description: str,
    requirements: dict | None = None,
    user_stories: dict | None = None,
    solution_architecture: dict | None = None
) -> str:
    context = f"Project Description: {project_description}\n\n"
    
    if requirements:
        context += f"Requirements:\n{json.dumps(requirements, indent=2)}\n\n"
    
    if user_stories:
        context += f"User Stories:\n{json.dumps(user_stories, indent=2)}\n\n"
        
    if solution_architecture:
        context += f"Solution Architecture:\n{json.dumps(solution_architecture, indent=2)}\n\n"
    
    return f"""
{context}

Design comprehensive UI/UX for this project following modern best practices.
Generate the structured UI/UX design output now.
"""


# ---------------------------------
# Main Agent Class
# ---------------------------------

class UIUXDesignAgent:
    def __init__(self, llm: LLMService | None = None, *, db=None, project_id: int | None = None):
        self.llm = llm or LLMService(db=db, project_id=project_id, role="architect")

    def run(
        self,
        project_description: str,
        requirements: dict | None = None,
        user_stories: dict | None = None,
        solution_architecture: dict | None = None
    ) -> UIUXDesignOutput:

        if not project_description:
            raise ValueError("Project description cannot be empty")

        if DEMO_MODE:
            result = UIUXDesignOutput(
                screens=[Screen(name="Dashboard", purpose="Demo mode")],
                userFlows=[],
                wireframes=[],
                componentRecommendations=[],
                uxRecommendations=[],
            )
            # Inject a fully structured React Flow visual UI as the fallback for DEMO_MODE
            result.ui_spec = {
                "pages": [
                    {
                        "page_name": "Demo Dashboard",
                        "path": "/demo",
                        "component_tree": [
                            {
                                "id": "demo-nav",
                                "type": "container",
                                "props": {
                                    "className": "w-full h-16 bg-gradient-to-r from-indigo-900 to-purple-900 flex items-center justify-between px-8 shadow-2xl",
                                    "style": {}
                                }
                            },
                            {
                                "id": "demo-logo",
                                "type": "text",
                                "props": {
                                    "content": "SDLC Platform (Demo Mode)",
                                    "className": "text-2xl font-bold text-white tracking-widest",
                                    "style": {}
                                }
                            },
                            {
                                "id": "demo-main",
                                "type": "container",
                                "props": {
                                    "className": "p-10 max-w-5xl mx-auto mt-10 bg-white/5 backdrop-blur-xl rounded-3xl border border-white/10 shadow-[0_0_40px_rgba(168,85,247,0.2)]",
                                    "style": {}
                                }
                            },
                            {
                                "id": "demo-title",
                                "type": "text",
                                "props": {
                                    "content": "No API Key Provided",
                                    "className": "text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-pink-500 to-violet-500 mb-6",
                                    "style": {"WebkitBackgroundClip": "text"}
                                }
                            },
                            {
                                "id": "demo-subtitle",
                                "type": "text",
                                "props": {
                                    "content": "The platform is currently running in DEMO_MODE. Please disable DEMO_MODE in the backend/.env file and provide a Gemini API key to experience the full AI-generated UI architecture.",
                                    "className": "text-lg text-gray-400 leading-relaxed",
                                    "style": {}
                                }
                            }
                        ],
                        "edges": [
                            {"source": "demo-nav", "target": "demo-logo", "type": "child"},
                            {"source": "demo-main", "target": "demo-title", "type": "child"},
                            {"source": "demo-main", "target": "demo-subtitle", "type": "child"}
                        ]
                    }
                ],
                "user_flows": ["User runs demo mode -> User sees fallback UI -> User configures API key"]
            }
        else:
            result = self.llm.generate_json(
                system=UIUX_AGENT_SYSTEM_PROMPT,
                prompt=build_uiux_prompt(project_description, requirements, user_stories, solution_architecture),
                schema=UIUXDesignOutput,
            )

        # --- GEMINI UI GENERATION FOR REACT FLOW ---
        api_key = os.getenv("GEMINI_API_KEY")
        if genai and api_key:
            try:
                client = genai.Client(api_key=api_key)
                prompt_text = f"Project Description: {project_description}\n"
                if solution_architecture:
                     prompt_text += f"Solution Architecture: {json.dumps(solution_architecture)}\n"
                
                SYSTEM_PROMPT = """You are an elite Senior UI/UX Architect designing ultra-premium, cutting-edge Web3/SaaS applications.
You must output a highly detailed Design Specification containing JAW-DROPPING, HIGH-FIDELITY visual mockups.
You must return the EXACT JSON structure as defined below:

{
  "project_name": "string",
  "design_system": {
    "colors": {
      "primary": "hex string",
      "background": "hex string",
      "text": "hex string"
    }
  },
  "user_flows": [
    "string"
  ],
  "pages": [
    {
      "page_name": "string (e.g. Home, Dashboard, Settings)",
      "path": "string",
      "component_tree": {
        "id": "string",
        "type": "string (e.g. div, nav, header, h1, button, p, span)",
        "label": "string or null. MUST BE REAL COPY (e.g. 'Sign In', 'Total Balance'). NEVER use placeholder words.",
        "props": { "className": "string", "style": {} },
        "children": [ ]
      }
    }
  ]
}

CRITICAL AESTHETIC GUIDELINES:
1. PREMIUM VISUAL EXCELLENCE: The UI must look like an award-winning modern application. Use glassmorphism (bg-white/10 backdrop-blur-lg), vibrant accent gradients (bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500), and deep layered shadows (shadow-2xl shadow-purple-500/20).
2. COMPLEX LAYOUTS: Never use simple flat layouts. Use sophisticated nested CSS Grids (grid-cols-1 md:grid-cols-3 xl:grid-cols-4) and flexbox arrangements with massive, breathable spacing (gap-8, p-10, py-20). Build beautiful complex hero sections, intricate sidebars, and dense data cards.
3. TYPOGRAPHY & MICRO-INTERACTIONS: Use elegant typography (tracking-tight, leading-relaxed, text-transparent bg-clip-text for gradient text). Add smooth hover effects to all interactive elements (hover:-translate-y-1 hover:scale-105 transition-all duration-300). Use 'style' objects for specific non-Tailwind tweaks if needed.
4. COPYWRITING: You are STRICTLY FORBIDDEN from using placeholder text. Write compelling, realistic, professional marketing copy and data values.
5. MULTI-PAGE: You MUST generate AT LEAST 3 distinct, heavily detailed pages to demonstrate a complete user flow.
"""
                contents = [types.Content(role="user", parts=[types.Part.from_text(text=prompt_text)])]
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        response_mime_type="application/json",
                        temperature=0.7,
                    ),
                )
                text = response.text.strip()
                if text.startswith("```json"):
                    text = text[7:]
                elif text.startswith("```"):
                    text = text[3:]
                if text.endswith("```"):
                    text = text[:-3]
                
                result.ui_spec = json.loads(text.strip())
            except Exception as e:
                print(f"Gemini UI generation failed: {e}")

        has_content = result and (
            result.screens or result.designSystem.colorPalette.primary
            or result.designSystem.typography.scale or result.componentRecommendations
            or result.ui_spec
        )
        if not has_content:
            raise ValueError("No UI/UX design generated")

        return result
