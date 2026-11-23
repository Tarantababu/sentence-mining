alter table study_cards add column if not exists queue text not null default 'due';
