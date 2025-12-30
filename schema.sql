CREATE TABLE IF NOT EXISTS user_profiles (
  email TEXT PRIMARY KEY,
  about_me TEXT,
  example_email TEXT,
  preferred_tone TEXT,
  preferred_model TEXT,
  
  -- Account Status
  plan_tier TEXT DEFAULT 'free', -- 'free', 'pro', 'enterprise'

  -- Usage Stats (Running Totals)
  total_emails_sent INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
