-- Shared ad library. One row per advertiser+ad, written by every run, so a
-- later search never resurfaces an ad we already have.
--
-- Apply with:  npm run supabase:setup
-- or paste into the Supabase SQL editor.

create table if not exists public.ads (
  library_id                text primary key,
  page_id                   text,
  business_key              text not null,
  page_name                 text,
  page_url                  text,
  page_profile_picture_url  text,
  page_categories           text[]      default '{}',

  followers_facebook        bigint,
  followers_instagram       bigint,
  instagram_handle          text,

  platforms                 text[]      default '{}',
  ads_running               integer     default 1,
  collation_id              text,
  ad_url                    text,

  is_active                 boolean,
  start_date                date,
  end_date                  date,
  days_running              integer,

  cta_text                  text,
  cta_type                  text,
  title                     text,
  body_text                 text,
  link_url                  text,
  display_domain            text,
  display_format            text,
  image_url                 text,
  video_url                 text,

  keyword                   text,
  keywords                  text[]      default '{}',
  country                   text,

  relevance_score           integer,
  relevance_reason          text,

  run_id                    uuid,
  first_seen_at             timestamptz default now(),
  last_updated_at           timestamptz default now()
);

-- One advertiser should appear once; we keep their longest-running ad.
create unique index if not exists ads_business_key_uniq on public.ads (business_key);

-- The Library page filters on these.
create index if not exists ads_page_name_idx      on public.ads (page_name);
create index if not exists ads_country_idx        on public.ads (country);
create index if not exists ads_keyword_idx        on public.ads (keyword);
create index if not exists ads_days_running_idx   on public.ads (days_running desc);
create index if not exists ads_followers_idx      on public.ads (followers_facebook desc);
create index if not exists ads_ads_running_idx    on public.ads (ads_running desc);
create index if not exists ads_first_seen_idx     on public.ads (first_seen_at desc);
create index if not exists ads_is_active_idx      on public.ads (is_active);
create index if not exists ads_relevance_idx      on public.ads (relevance_score desc);
create index if not exists ads_categories_gin     on public.ads using gin (page_categories);
create index if not exists ads_platforms_gin      on public.ads using gin (platforms);
create index if not exists ads_keywords_gin       on public.ads using gin (keywords);

-- Free-text search across the fields people actually search by.
create index if not exists ads_search_idx on public.ads using gin (
  to_tsvector('english',
    coalesce(page_name,'') || ' ' || coalesce(title,'') || ' ' ||
    coalesce(body_text,'') || ' ' || coalesce(display_domain,''))
);

-- Every ad id we have ever processed, including ones dropped as irrelevant, so
-- repeat runs don't pay to re-evaluate them.
create table if not exists public.seen_ads (
  library_id  text primary key,
  page_id     text,
  run_id      uuid,
  outcome     text,               -- kept | irrelevant | duplicate
  seen_at     timestamptz default now()
);
create index if not exists seen_ads_page_idx on public.seen_ads (page_id);

-- Run history. The Library is organised around these: each run is one
-- "execution" the user can expand to see exactly what it collected.
create table if not exists public.runs (
  id                  uuid primary key,
  name                text,               -- human label, unique-ish and findable
  seq                 integer,            -- nth run of this same search
  keywords            text[] default '{}',
  countries           text[] default '{}',
  filters             jsonb,
  target              integer,
  status              text,
  kept                integer default 0,
  skipped_known       integer default 0,
  skipped_irrelevant  integer default 0,
  raw_seen            integer default 0,
  started_at          timestamptz,
  finished_at         timestamptz,
  created_at          timestamptz default now()
);
create index if not exists runs_created_idx on public.runs (created_at desc);

-- Added after the first release; harmless to re-run.
alter table public.runs add column if not exists name      text;
alter table public.runs add column if not exists seq       integer;
alter table public.runs add column if not exists keywords  text[] default '{}';
alter table public.runs add column if not exists countries text[] default '{}';

-- Ads are grouped by the run that collected them.
create index if not exists ads_run_idx on public.ads (run_id);

-- The server talks to Supabase with the service_role key, which bypasses RLS.
-- RLS is enabled anyway so the anon/publishable key cannot read the table if it
-- is ever exposed to a browser.
alter table public.ads      enable row level security;
alter table public.seen_ads enable row level security;
alter table public.runs     enable row level security;

-- Advertiser "About" tab details (added after first release).
alter table public.ads add column if not exists facebook_handle  text;
alter table public.ads add column if not exists page_category    text;
alter table public.ads add column if not exists advertiser_bio   text;
alter table public.ads add column if not exists page_created_on  text;
