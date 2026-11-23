delete from reviews;
delete from study_cards;
delete from study_packs;
delete from session_errors;
delete from session_vocab;
delete from session_tracking;
delete from sessions;
delete from unit_memories;
delete from units
 where key not in (
   'do_the_school_run',
   'no_point_in_ing',
   'by_hand',
   'attend_no_prep',
   'schedule_meeting',
   'for_free_vs_freely',
   'rather_not_vs_wouldnt_prefer',
   'articles_a_the_zero'
 );
