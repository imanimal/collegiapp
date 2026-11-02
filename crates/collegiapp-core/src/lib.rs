//! Collegiapp core: platform-independent logic shared by the desktop shell (Tauri) and,
//! later, iOS.
//!
//! Design: everything is ONE [`model::Item`] with a [`model::ItemKind`]; screens are saved
//! filters ([`model::View`] + [`filter`]) over the same list; "do first" is one explainable
//! [`score`]; storage is local-first and syncs per record with last-write-wins ([`sync`]).
//!
//! All functions are pure: the caller passes `now` (and a time zone where days matter).
//! `quickadd`, `filter` and `score` have JavaScript mirrors in the UI — keep them in sync.

pub mod filter;
pub mod gradescope;
pub mod ics;
pub mod model;
pub mod pocketcanvas;
pub mod presence;
pub mod quickadd;
pub mod score;
pub mod sync;
pub mod webwork;

pub use filter::{run_query, Ctx, Filter, FilterTerm};
pub use model::{
    default_views, merge_imported, remove_course, stable_id, Course, ImportCounts, InterruptLevel,
    Item, ItemKind, Lens, Link, Sort, Source, Status, View,
};
pub use presence::{alerts_due, next_up, Presence};
pub use quickadd::{Draft, Token, TokenKind};
pub use score::{rank, RankedItem, Score};
pub use sync::{merge, merge_sets, merge_sets_report, MergeReport};
