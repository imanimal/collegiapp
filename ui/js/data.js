/* Collegiapp — SAMPLE data for the prototype. Times are generated relative to "now" so the
   demo always has a class about to start, something due tonight and something overdue.
   Real data will come from the Rust core (Canvas / Google Calendar / Shoreline / manual). */
(function () {
  const CA = (window.CA = window.CA || {});
  const MIN = 60e3, HR = 36e5;

  // Campus places for location banners. Keys are what a location starts with ("PHELP 1160", "CSIL · or Zoom");
  // named: true means the key is a place name, not a building code. xy = rough metres from Davidson Library
  // (x east, y north), used only for walking estimates, so treat them as approximate and editable.
  CA.places = {
    "PHELP": { name: "Phelps Hall", xy: [-170, 140] },
    "GIRV": { name: "Girvetz Hall", xy: [-60, 230] },
    "BUCHN": { name: "Buchanan Hall", xy: [240, 110] },
    "HFH": { name: "Harold Frank Hall", xy: [330, 40] },
    "CSIL": { name: "CS Instructional Lab", note: "Harold Frank Hall", xy: [330, 40] },
    "IV THEA": { name: "Isla Vista Theater", note: "off campus", xy: [-1050, -120] },
    "Library": { name: "Davidson Library", named: true, xy: [0, 0] },
    "UCSB Bookstore": { name: "UCSB Bookstore", note: "UCen", named: true, xy: [280, 300] },
    "Corwin Pavilion": { name: "Corwin Pavilion", note: "UCen", named: true, xy: [340, 330] },
    "Storke Plaza": { name: "Storke Plaza", named: true, xy: [200, 320] },
  };
  // Where your day starts when nothing earlier is scheduled (settable later; Isla Vista for the sample).
  CA.home = { name: "Home · Isla Vista", short: "home", xy: [-900, -250] };

  // UCSB Fall 2026: instruction Thu Sep 24 – Fri Dec 4, finals Sat Dec 5 – Fri Dec 11 (catalog.ucsb.edu).
  CA.quarter = { code: "F26", name: "Fall 2026", week1: new Date(2026, 8, 28), finals: new Date(2026, 11, 5), weeks: 10 };

  function at(dayOff, h, m) { const d = new Date(); d.setDate(d.getDate() + dayOff); d.setHours(h, m || 0, 0, 0); return d.getTime(); }
  const eod = (dayOff) => at(dayOff, 23, 59);

  const PH = "https://www.canvas.ucsb.edu/courses/";
  const courses = [
    { id: "c130a", code: "CMPSC 130A", tag: "CS130A", title: "Data Structures & Algorithms I", color: 1, aliases: ["algo", "dsa"], included: true,
      meet: [{ days: "TR", h: 9, m: 30, dur: 75, loc: "PHELP 1160", label: "Lecture" }, { days: "F", h: 13, m: 0, dur: 50, loc: "GIRV 1115", label: "Section" }],
      links: [["Canvas", PH + "0001"], ["Gradescope", "https://www.gradescope.com/"], ["Piazza", "https://piazza.com/"], ["Syllabus", PH + "0001/assignments/syllabus"], ["Zoom", "https://ucsb.zoom.us/"]] },
    { id: "c154", code: "CMPSC 154", tag: "CS154", title: "Computer Architecture", color: 2, aliases: ["arch"], included: true,
      meet: [{ days: "MW", h: 14, m: 0, dur: 75, loc: "PHELP 3526", label: "Lecture" }],
      links: [["Canvas", PH + "0002"], ["Gradescope", "https://www.gradescope.com/"], ["PyRTL docs", "https://pyrtl.readthedocs.io/"], ["Syllabus", PH + "0002/assignments/syllabus"]] },
    { id: "c138", code: "CMPSC 138", tag: "CS138", title: "Automata & Formal Languages", color: 3, aliases: ["automata", "toc"], included: true,
      meet: [{ days: "TR", h: 12, m: 30, dur: 75, loc: "BUCHN 1910", label: "Lecture" }],
      links: [["Canvas", PH + "0003"], ["Gradescope", "https://www.gradescope.com/"], ["Piazza", "https://piazza.com/"]] },
    { id: "p120a", code: "PSTAT 120A", tag: "PSTAT", title: "Probability & Statistics", color: 4, aliases: ["prob", "stats"], included: true,
      meet: [{ days: "MWF", h: 10, m: 0, dur: 50, loc: "IV THEA 1", label: "Lecture" }],
      links: [["Canvas", PH + "0004"], ["WeBWorK", "https://webwork.math.ucsb.edu/"], ["Zoom OH", "https://ucsb.zoom.us/"]] },
    // Canvas clutter the user has excluded — still synced, hidden everywhere.
    { id: "x16", code: "CMPSC 16", tag: "CS16", title: "Problem Solving I (Fall 2024)", color: 5, aliases: [], included: false, meet: [], links: [["Canvas", PH + "0005"]] },
    { id: "xlib", code: "LIB 101", tag: "LIB", title: "Library Research Tutorial", color: 6, aliases: [], included: false, meet: [], links: [["Canvas", PH + "0006"]] },
    { id: "xaim", code: "AIM", tag: "AIM", title: "Academic Integrity Module", color: 5, aliases: [], included: false, meet: [], links: [["Canvas", PH + "0007"]] },
    { id: "xtut", code: "CS TUTOR", tag: "TUTOR", title: "CS Tutoring Hub", color: 6, aliases: [], included: false, meet: [], links: [["Canvas", PH + "0008"]] },
  ];

  // Google Calendar series the user has (or hasn't) marked as classes.
  const calendarSeries = [
    { id: "g1", name: "CMPSC 130A LEC", rule: "TR 9:30–10:45", isClass: true, course: "c130a" },
    { id: "g2", name: "CMPSC 130A DIS", rule: "F 13:00–13:50", isClass: true, course: "c130a" },
    { id: "g3", name: "CMPSC 154", rule: "MW 14:00–15:15", isClass: true, course: "c154" },
    { id: "g4", name: "CS138 Lecture", rule: "TR 12:30–13:45", isClass: true, course: "c138" },
    { id: "g5", name: "PSTAT 120A", rule: "MWF 10:00–10:50", isClass: true, course: "p120a" },
    { id: "g6", name: "Rec Cen climbing", rule: "TR 18:00–19:30", isClass: false },
    { id: "g7", name: "Shift @ Library desk", rule: "Sa 10:00–14:00", isClass: false },
  ];

  let seq = 0;
  function item(o) {
    const now = Date.now();
    return Object.assign({ id: "i" + (++seq), kind: "task", status: "todo", course: null, due: null, end: null, est: null, pri: 0, weight: null,
      tags: [], links: [], location: null, notes: "", interrupt: "none", src: "manual", snoozed: null, created: now - 3 * 864e5, updated: now - (seq * 7 * MIN) }, o);
  }

  CA.sampleData = function () {
    seq = 0;
    const now = Date.now();
    const items = [
      item({ title: "HW 6: Joint distributions", kind: "assignment", course: "p120a", due: eod(0), est: 90, pri: 1, weight: 2, src: "canvas",
        links: [["WeBWorK set 6", "https://webwork.math.ucsb.edu/"], ["Canvas", PH + "0004/assignments/6"]], notes: "Problems 3 and 7 need the change-of-variables trick from Thursday." }),
      item({ title: "Lab 3: PyRTL ALU", kind: "lab", course: "c154", due: eod(1), est: 240, pri: 2, weight: 5, status: "doing", src: "canvas",
        links: [["Lab spec", PH + "0002/assignments/3"], ["Gradescope", "https://www.gradescope.com/"], ["PyRTL docs", "https://pyrtl.readthedocs.io/"]], notes: "Checkpoint: adder + shifter pass. Still need SLT and the zero flag." }),
      item({ title: "PA2: Heaps & hash tables", kind: "assignment", course: "c130a", due: eod(3), est: 300, pri: 1, weight: 8, src: "canvas",
        links: [["Spec", PH + "0001/assignments/2"], ["Gradescope", "https://www.gradescope.com/"], ["Piazza @212", "https://piazza.com/"]] }),
      item({ title: "HW 4: Amortized analysis", kind: "assignment", course: "c130a", due: eod(5), est: 120, weight: 3, src: "gradescope",
        notes: "Found by the Firefox adapter on Gradescope; not posted on Canvas." }),
      item({ title: "Midterm 2", kind: "exam", course: "c130a", due: at(12, 9, 30), est: 600, pri: 2, weight: 20, tags: ["exam"], location: "PHELP 1160", src: "canvas", interrupt: "alert" }),
      item({ title: "Midterm", kind: "exam", course: "p120a", due: at(6, 10, 0), est: 480, pri: 2, weight: 25, tags: ["exam"], location: "IV THEA 1", src: "canvas", interrupt: "alert" }),
      item({ title: "HW 5: Pumping lemma", kind: "assignment", course: "c138", due: eod(2), est: 180, pri: 1, weight: 4, src: "gradescope" }),
      item({ title: "Read Sipser 2.1–2.2", kind: "reading", course: "c138", due: at(1, 12, 0), est: 45, src: "canvas" }),
      item({ title: "Quiz 4: Pipelining", kind: "quiz", course: "c154", due: at(4, 9, 0), est: 20, weight: 1, src: "canvas" }),
      item({ title: "Reading response: memory hierarchy", kind: "assignment", course: "c154", due: now - 3 * HR, est: 20, pri: 1, weight: 1, src: "canvas" }),
      item({ title: "Email TA about PA1 regrade", kind: "errand", course: "c130a", due: now + 2 * HR, est: 10, pri: 2, status: "inbox" }),
      item({ title: "Summer SWE internship application", kind: "application", due: eod(14), est: 90, pri: 2, tags: ["career"], links: [["Handshake", "https://ucsb.joinhandshake.com/"]] }),
      item({ title: "Renew Davidson Library book", kind: "errand", due: eod(2), est: 5, location: "Library" }),
      item({ title: "LeetCode: 2 mediums", kind: "task", due: eod(0), est: 60, tags: ["interview-prep"], notes: "Repeats daily." }),
      item({ title: "Buy blue books", kind: "errand", status: "inbox", est: 10, location: "UCSB Bookstore" }),
      item({ title: "Ask Prof about undergrad research", kind: "task", status: "inbox", est: 15 }),
      item({ title: "Final exam (30%)", kind: "info", status: "inbox", course: "c154", src: "canvas" }),
      item({ title: "Final course grade (with bonus)", kind: "info", course: "c154", src: "canvas" }),
      item({ title: "HW 3: Recurrences", kind: "assignment", course: "c130a", due: eod(-2), status: "done", src: "canvas", updated: now - 30 * HR }),
      item({ title: "HW 5: Discrete RVs", kind: "assignment", course: "p120a", due: eod(-1), status: "done", src: "canvas", updated: now - 20 * HR }),
      item({ title: "ACM: Intro to Rust workshop", kind: "event", due: at(3, 18, 0), end: at(3, 19, 30), location: "HFH 1132", src: "shoreline", tags: ["club"],
        notes: "RSVP: Registered.", links: [["Shoreline", "https://shoreline.ucsb.edu/"]] }),
      item({ title: "Engineering & Tech Career Fair", kind: "event", due: at(4, 11, 0), end: at(4, 15, 0), location: "Corwin Pavilion", src: "shoreline", tags: ["career"], interrupt: "nudge",
        links: [["Shoreline", "https://shoreline.ucsb.edu/"]] }),
      item({ title: "A.S. Program Board fall concert", kind: "ticket", due: at(9, 20, 0), end: at(9, 23, 0), location: "Storke Plaza", src: "shoreline",
        notes: "Ticket PB-4471 · View Ticket (PDF) in Shoreline · bring student ID.", links: [["My registrations", "https://shoreline.ucsb.edu/"]] }),
      item({ title: "130A TA office hours", kind: "office_hours", course: "c130a", due: at(1, 15, 0), end: at(1, 16, 0), location: "CSIL · or Zoom", src: "gcal",
        links: [["Zoom", "https://ucsb.zoom.us/"]] }),
      item({ title: "Lab 09 (archived)", kind: "lab", course: "x16", due: eod(1), src: "canvas" }),
      item({ title: "Module 3 quiz", kind: "quiz", course: "xaim", due: eod(4), src: "canvas" }),
      item({ title: "Tutoring sign-up", kind: "task", course: "xtut", due: eod(2), src: "canvas" }),
    ];

    // Class sessions: two pinned near "now" for the demo, then the real weekly pattern.
    const cls = (course, label, start, dur, loc) => item({ title: label, kind: "class", course, due: start, end: start + dur * MIN, location: loc, src: "gcal", interrupt: "alert",
      links: (courses.find((c) => c.id === course).links || []).filter((l) => /zoom|canvas/i.test(l[0])) });
    items.push(cls("c154", "Lab section", now - 80 * MIN, 75, "PHELP 3526"));
    items.push(cls("c130a", "Midterm 2 review session", now + 23 * MIN, 80, "PHELP 1160"));
    const DAYS = "UMTWRFS";
    for (let d = 1; d <= 8; d++) {
      const day = new Date(); day.setDate(day.getDate() + d);
      const letter = DAYS[day.getDay()];
      for (const c of courses) for (const mt of c.meet) if (mt.days.includes(letter)) items.push(cls(c.id, mt.label, at(d, mt.h, mt.m), mt.dur, mt.loc));
    }
    return { courses: JSON.parse(JSON.stringify(courses)), items, calendarSeries: JSON.parse(JSON.stringify(calendarSeries)) };
  };
})();
