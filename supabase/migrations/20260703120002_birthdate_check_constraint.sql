-- Reject future or unreasonable birthdates in consumer_profiles.
ALTER TABLE consumer_profiles
  ADD CONSTRAINT chk_birthdate_in_past
  CHECK (birthdate IS NULL OR birthdate < CURRENT_DATE);
