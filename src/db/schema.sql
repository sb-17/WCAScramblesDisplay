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

-- One row per WCA competition. Unique on the WCA id deliberately: two Delegates at the
-- same competition must share one setup rather than each uploading their own, so a
-- collision means "already set up -- ask them for access", not "make a second one".
create table if not exists competitions (
  id                  uuid primary key default gen_random_uuid(),
  wca_competition_id  text not null unique,
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
