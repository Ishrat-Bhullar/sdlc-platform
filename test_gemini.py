import os
from google import genai
from google.genai import types
import json

api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key)

current_spec = {
  "project_name": "Test App",
  "pages": [
    {
      "page_name": "Home",
      "path": "/",
      "component_tree": {
        "type": "div",
        "label": "Main",
        "props": {"className": "bg-white"},
        "children": [
          {"type": "button", "label": "Click Me", "props": {"className": "bg-blue-500"}, "children": []}
        ]
      }
    }
  ]
}

current_context = f"\nCURRENT APPLICATION SPECIFICATION TO MODIFY:\n{json.dumps(current_spec)}\n\nDo NOT create a new application. You must strictly modify the CURRENT APPLICATION SPECIFICATION based on the user's request. Keep everything else intact.\n"

SYSTEM_PROMPT = f"""You are an elite Senior UI/UX Architect. 
You must output a highly detailed Design Specification containing HIGH-FIDELITY visual mockups.
You must return the EXACT JSON structure as defined below:

{{
  "project_name": "string",
  "design_system": {{ "colors": {{ "primary": "hex", "background": "hex", "text": "hex" }} }},
  "user_flows": ["string"],
  "pages": [
    {{
      "page_name": "string",
      "path": "string",
      "component_tree": {{
        "id": "string", "type": "string", "label": "string", "props": {{ "className": "string" }}, "children": []
      }}
    }}
  ]
}}

CRITICAL GUIDELINES:
1. COPYWRITING: No placeholder text.
2. MULTI-PAGE: Maintain all existing pages.
3. CONVERSATIONAL EDITING: You MUST return the ENTIRE JSON structure again, including all unmodified pages. Do not omit pages.
{current_context}"""

response = client.models.generate_content(
    model='gemini-2.5-flash',
    contents=[types.Content(role="user", parts=[types.Part.from_text(text="make the button rounded")])],
    config=types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        response_mime_type="application/json",
        temperature=0.7,
    ),
)
print(response.text)
