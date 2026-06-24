-- Fixture: Rule 3 pass — CREATE TABLE names using allowed ontology patterns.

-- Core ontology name
CREATE TABLE entities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  type text NOT NULL
);

-- dim_ prefix
CREATE TABLE dim_product_category (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL
);

-- fact_ prefix
CREATE TABLE fact_revenue_daily (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  amount numeric NOT NULL
);
