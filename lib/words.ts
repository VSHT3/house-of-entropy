// A compact bank of common English words used to fill "readable" search-result pages with
// plausible prose-like text around the query (instead of pure noise). All lowercase and
// within the page alphabet.
export const WORDS = (
  "the of and a to in is was he for it with as his on be at by i this had not are but from " +
  "or have an they which one you were her all she there would their we him been has when who " +
  "will more no if out so said what up its about into than them can only other new some could " +
  "time these two may then do first any my now such like our over man me even most made after " +
  "also did many before must through back years where much your way well down should because " +
  "each just those people mister how too little state good very make world still own see men " +
  "work long here between both life being under never day same another know while last might us " +
  "great old year off come since against go came right used take three states himself few house " +
  "use during without again place american around however home small found thought went say part " +
  "once general high upon school every don does got united left number course war until always " +
  "away something fact water though less public put think almost hand enough far took head yet " +
  "government system better set told nothing night end why called eyes find going look asked " +
  "later knew light house word things mind name room dark door light shadow page book wall stair " +
  "letter silence dust mirror endless meaning order chance truth hidden voice whisper distant"
).split(/\s+/).filter(Boolean);

// Punctuation that can appear between words (weighted: mostly spaces).
export const SEPARATORS = [" ", " ", " ", " ", " ", ", ", ". ", "; ", " - ", ": "];
