-- Everything in a bytea column here is ciphertext or a wrapped key. The server has no
-- means of reading any of it: the only keys that could open these rows live in Delegates'
-- browsers and on paired display devices.
--
-- Applied with: npm run migrate

create extension if not exists pgcrypto;

-- A Delegate who has signed in at least once.
create table if not exists users (
  wca_user_id      integer primary key,
  name             text not null,
  wca_id           text,
  delegate_status  text not null,

  -- Raw P-256, 65 bytes. Null until the browser has generated an identity.
  public_key       bytea,

  -- Identity private key wrapped under the recovery phrase. The phrase itself is never
  -- sent, so this stays unreadable to the server.
  recovery_salt    bytea,
  recovery_blob    bytea,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- One row per competition. Unique on the WCA id deliberately: two Delegates at the same
-- competition must share one setup rather than each uploading their own, so a collision
-- means "already set up -- ask them for access", not "make a second one".
--
-- A null wca_competition_id means an unofficial competition, which is also how testing is
-- done -- nobody should generate scrambles for a real competition just to try this out.
-- Postgres permits many nulls in a unique column, so unofficial competitions do not
-- collide with each other.
create table if not exists competitions (
  id                  uuid primary key default gen_random_uuid(),
  wca_competition_id  text unique,
  name                text not null,

  -- Drives automatic purging of scramble data once the competition is over.
  ends_on             date,

  created_by          integer not null references users (wca_user_id),
  created_at          timestamptz not null default now()
);

-- Which Delegates can reach a competition, and the competition key wrapped to each of
-- them. Revoking access is deleting the row: without a wrapper, the key is gone.
create table if not exists competition_access (
  competition_id           uuid not null references competitions (id) on delete cascade,
  wca_user_id              integer not null references users (wca_user_id),
  wrapped_competition_key  bytea not null,

  -- Lets the owner hold a co-delegate at view-only.
  can_push                 boolean not null default true,

  granted_by               integer not null references users (wca_user_id),
  granted_at               timestamptz not null default now(),
  primary key (competition_id, wca_user_id)
);

-- One scramble set. `label` is the TNoodle filename minus .pdf, which is also the key
-- used in the passcode file. The identity columns are nullable because a label that does
-- not parse is still perfectly usable -- we never drop a set for being oddly named.
create table if not exists scramble_sets (
  id               uuid primary key default gen_random_uuid(),
  competition_id   uuid not null references competitions (id) on delete cascade,
  label            text not null,
  event_name       text,
  round_number     integer,
  set_letter       text,

  -- Set key encrypted under the competition key.
  wrapped_set_key  bytea not null,

  -- The original TNoodle PDF concatenated with its own passcode, encrypted under the set
  -- key. The PDF is byte-identical to what TNoodle produced and still passcode-protected
  -- in its own right, so two independent layers survive.
  ciphertext       bytea not null,

  created_at       timestamptz not null default now(),
  unique (competition_id, label)
);

create index if not exists scramble_sets_competition_idx
  on scramble_sets (competition_id);

-- A display in the scrambling area.
--
-- The Delegate creates the slot and gets a one-time code, which is typed into the device.
-- The device then generates its own keypair and posts the public half when claiming the
-- code; scramble set keys are later wrapped to that public key, so a device can only open
-- what it has been sent deliberately.
create table if not exists devices (
  id                  uuid primary key default gen_random_uuid(),
  competition_id      uuid not null references competitions (id) on delete cascade,
  name                text not null,

  -- Single use and short lived. Cleared on claim, so a code cannot be replayed.
  activation_code     text unique,
  code_expires_at     timestamptz,

  -- Set when the device claims its code.
  public_key          bytea,
  -- SHA-256 of the device's bearer token. The token itself is shown to the device once.
  token_hash          bytea,
  paired_at           timestamptz,

  -- Hard cap chosen by the Delegate at creation, extendable from their phone.
  session_expires_at  timestamptz,
  last_seen_at        timestamptz,

  created_by          integer not null references users (wca_user_id),
  created_at          timestamptz not null default now()
);

create index if not exists devices_competition_idx on devices (competition_id);

-- What each device is showing. Added separately so existing databases pick it up.
--
-- current_wrapped_key is the set key wrapped to this device's public key, and it is
-- replaced on every push. A device therefore holds a key only for what is on screen right
-- now: a lost tablet leaks one group, not the weekend.
alter table devices add column if not exists current_set_id uuid
  references scramble_sets (id) on delete set null;
alter table devices add column if not exists current_wrapped_key bytea;
alter table devices add column if not exists pushed_at timestamptz;

-- What the device says it is showing, which is what the Delegate's phone displays. The
-- intended state and the real state are not the same thing.
alter table devices add column if not exists acked_set_id uuid;
alter table devices add column if not exists acked_at timestamptz;

-- A set arrives decrypted but covered until a scrambler confirms it is the group they are
-- about to scramble. Typing a passcode used to catch a wrong set by simply not opening it;
-- pushing has no such failure, so the check is put back where it was -- at the table, by
-- the person who knows which group is up.
--
-- Defaults true so rows written before this existed are not reported as unconfirmed.
alter table devices add column if not exists acked_confirmed boolean not null default true;

-- Names are denormalised so the log survives deleting a device or a competition's sets.
create table if not exists push_log (
  id              uuid primary key default gen_random_uuid(),
  competition_id  uuid not null references competitions (id) on delete cascade,
  device_name     text not null,
  set_label       text,
  pushed_by       integer not null references users (wca_user_id),
  pushed_at       timestamptz not null default now()
);

create index if not exists push_log_competition_idx on push_log (competition_id, pushed_at desc);

-- Applied separately so databases created before unofficial competitions existed pick the
-- change up. Dropping a constraint that is already absent is a no-op, so this stays
-- re-runnable like everything else above.
alter table competitions alter column wca_competition_id drop not null;
