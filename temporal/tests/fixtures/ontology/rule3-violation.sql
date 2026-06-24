-- Fixture: Rule 3 violation — CREATE TABLE with a name outside the ontology shape.
CREATE TABLE user_preferences (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  preference_key text NOT NULL,
  preference_value text
);
