-- Add additional parkrun event name mappings
-- Includes "parkrun du" prefix handling and new location mappings

INSERT INTO parkrun_event_name_mappings (from_name, to_name, notes) VALUES
  ('Camperdown', 'Camperdown, Dundee', 'Add location for clarity'),
  ('Stewart', 'Stewart, Middlesbrough', 'Add location for clarity'),
  ('Brockwell', 'Brockwell, Herne Hill', 'Add location for clarity'),
  ('Bois de Boulogne', 'Bois de Boulogne, Paris', 'Add location for clarity'),
  ('Finsbury Park', 'Finsbury', 'Standardize name'),
  ('Pollok', 'Pollok, Glasgow', 'Add location for clarity'),
  ('Mansfield QLD', 'Mansfield, Queensland', 'Standardize location format')
ON CONFLICT(from_name) DO UPDATE SET
  to_name = excluded.to_name,
  notes = excluded.notes;
