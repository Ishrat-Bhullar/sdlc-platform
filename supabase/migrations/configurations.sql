/*
# Create project_configurations table for persisting wizard selections

1. New Tables
- `project_configurations`
  - `id` (uuid, primary key)
  - `user_id` (uuid, not null, defaults to authenticated user, references auth.users)
  - `name` (text, project name)
  - `description` (text, project description)
  - `project_type` (text, e.g. rag-chatbot, ai-agent-platform, web-app, etc.)
  - `execution_mode` (text, one of: auto, manual, hybrid)
  - `build_type` (text, one of: open-source, private-enterprise, internal-organization)
  - `deliverables` (jsonb, array of selected deliverable IDs)
  - `manual_stages` (jsonb, array of stage IDs selected manually for hybrid mode)
  - `provider_settings` (jsonb, object of provider -> { enabled, keySource })
  - `api_keys` (jsonb, object of provider -> encrypted key reference)
  - `status` (text, default 'draft')
  - `created_at` (timestamptz)
  - `updated_at` (timestamptz)

2. Security
- Enable RLS on `project_configurations`.
- Owner-scoped CRUD: each authenticated user can only access their own project configurations.
- 4 separate policies (select/insert/update/delete), all using auth.uid() = user_id.
- user_id has DEFAULT auth.uid() so inserts without explicit user_id succeed.
*/

CREATE TABLE IF NOT EXISTS project_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  project_type text,
  execution_mode text,
  build_type text,
  deliverables jsonb DEFAULT '[]'::jsonb,
  manual_stages jsonb DEFAULT '[]'::jsonb,
  provider_settings jsonb DEFAULT '{}'::jsonb,
  api_keys jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE project_configurations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_project_configs" ON project_configurations;
CREATE POLICY "select_own_project_configs"
ON project_configurations FOR SELECT
TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_own_project_configs" ON project_configurations;
CREATE POLICY "insert_own_project_configs"
ON project_configurations FOR INSERT
TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_own_project_configs" ON project_configurations;
CREATE POLICY "update_own_project_configs"
ON project_configurations FOR UPDATE
TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_own_project_configs" ON project_configurations;
CREATE POLICY "delete_own_project_configs"
ON project_configurations FOR DELETE
TO authenticated USING (auth.uid() = user_id);