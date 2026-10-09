/**
 * Per-country search details for every ISO country (docs/mvp/19 Phase 3): the main business-news
 * language, the GDELT source-country code (FIPS 10-4), the Tavily `country` boost name and the Bing
 * News market. Pure data; a country missing here still works with English and its name in the query.
 *
 * Sources: GDELT DOC 2.0 `sourcecountry:` takes FIPS codes (data.gdeltproject.org/api/v2/guides/
 * LOOKUP-COUNTRIES.TXT); Tavily `country` takes the lowercase names in its API reference (general topic
 * only); Bing News RSS takes `mkt=<lang>-<CC>` and answers in that language (probed 10 Oct: ar-SA,
 * ar-AE, de-DE, tr-TR, pt-BR return local articles with original links).
 */
import { COUNTRIES } from './countries';

/** ISO 3166-1 → FIPS 10-4 (GDELT), generated from GDELT's lookup by name with manual fixes. */
export const GDELT_FIPS: Readonly<Record<string, string>> = {
  AD:'AN',AE:'AE',AF:'AF',AG:'AC',AI:'AV',AL:'AL',AM:'AM',AO:'AO',AQ:'AY',AR:'AR',AS:'AQ',AT:'AU',AU:'AS',AW:'AA',AZ:'AJ',BA:'BK',BB:'BB',BD:'BG',
  BE:'BE',BF:'UV',BG:'BU',BH:'BA',BI:'BY',BJ:'BN',BL:'TB',BM:'BD',BN:'BX',BO:'BL',BQ:'NL',BR:'BR',BS:'BF',BT:'BT',BV:'BV',BW:'BC',BY:'BO',BZ:'BH',
  CA:'CA',CC:'CK',CD:'CG',CF:'CT',CG:'CF',CH:'SZ',CI:'IV',CK:'CW',CL:'CI',CM:'CM',CN:'CH',CO:'CO',CR:'CS',CU:'CU',CV:'CV',CW:'UC',CX:'KT',CY:'CY',
  CZ:'EZ',DE:'GM',DJ:'DJ',DK:'DA',DM:'DO',DO:'DR',DZ:'AG',EC:'EC',EE:'EN',EG:'EG',EH:'WI',ER:'ER',ES:'SP',ET:'ET',FI:'FI',FJ:'FJ',FK:'FK',FM:'FM',
  FO:'FO',FR:'FR',GA:'GB',GB:'UK',GD:'GJ',GE:'GG',GF:'FG',GG:'GK',GH:'GH',GI:'GI',GL:'GL',GM:'GA',GN:'GV',GP:'GP',GQ:'EK',GR:'GR',GS:'SX',GT:'GT',
  GU:'GQ',GW:'PU',GY:'GY',HK:'HK',HM:'HM',HN:'HO',HR:'HR',HT:'HA',HU:'HU',ID:'ID',IE:'EI',IL:'IS',IM:'IM',IN:'IN',IO:'IO',IQ:'IZ',IR:'IR',IS:'IC',
  IT:'IT',JE:'JE',JM:'JM',JO:'JO',JP:'JA',KE:'KE',KG:'KG',KH:'CB',KI:'KR',KM:'CN',KN:'SC',KP:'KN',KR:'KS',KW:'KU',KY:'CJ',KZ:'KZ',LA:'LA',LB:'LE',
  LC:'ST',LI:'LS',LK:'CE',LR:'LI',LS:'LT',LT:'LH',LU:'LU',LV:'LG',LY:'LY',MA:'MO',MC:'MN',MD:'MD',ME:'MJ',MF:'RN',MG:'MA',MH:'RM',MK:'MK',ML:'ML',
  MM:'BM',MN:'MG',MO:'MC',MP:'CQ',MQ:'MB',MR:'MR',MS:'MH',MT:'MT',MU:'MP',MV:'MV',MW:'MI',MX:'MX',MY:'MY',MZ:'MZ',NA:'WA',NC:'NC',NE:'NG',NF:'NF',
  NG:'NI',NI:'NU',NL:'NL',NO:'NO',NP:'NP',NR:'NR',NU:'NE',NZ:'NZ',OM:'MU',PA:'PM',PE:'PE',PF:'FP',PG:'PP',PH:'RP',PK:'PK',PL:'PL',PM:'SB',PN:'PC',
  PR:'RQ',PS:'WE',PT:'PO',PW:'PS',PY:'PA',QA:'QA',RE:'RE',RO:'RO',RS:'RI',RU:'RS',RW:'RW',SA:'SA',SB:'BP',SC:'SE',SD:'SU',SE:'SW',SG:'SN',SH:'SH',
  SI:'SI',SJ:'SV',SK:'LO',SL:'SL',SM:'SM',SN:'SG',SO:'SO',SR:'NS',SS:'OD',ST:'TP',SV:'ES',SX:'NN',SY:'SY',SZ:'WZ',TC:'TK',TD:'CD',TF:'FS',TG:'TO',
  TH:'TH',TJ:'TI',TK:'TL',TL:'TT',TM:'TX',TN:'TS',TO:'TN',TR:'TU',TT:'TD',TV:'TV',TW:'TW',TZ:'TZ',UA:'UP',UG:'UG',US:'US',UY:'UY',UZ:'UZ',VA:'VT',
  VC:'VC',VE:'VE',VG:'VI',VI:'VQ',VN:'VM',VU:'NH',WF:'WF',WS:'WS',YE:'YM',YT:'MF',ZA:'SF',ZM:'ZA',ZW:'ZI',
};

/** Main language of business and project news (ISO 639-1). Absent = English. */
const LANG: Readonly<Record<string, string>> = {
  // Arabic
  AE:'ar',SA:'ar',QA:'ar',OM:'ar',KW:'ar',BH:'ar',EG:'ar',JO:'ar',LB:'ar',SY:'ar',IQ:'ar',YE:'ar',LY:'ar',SD:'ar',DZ:'ar',MA:'ar',TN:'ar',MR:'ar',PS:'ar',
  // French
  FR:'fr',LU:'fr',MC:'fr',SN:'fr',CI:'fr',ML:'fr',BF:'fr',NE:'fr',TD:'fr',GN:'fr',BJ:'fr',TG:'fr',CM:'fr',GA:'fr',CG:'fr',CD:'fr',CF:'fr',MG:'fr',DJ:'fr',KM:'fr',BI:'fr',HT:'fr',
  // Spanish
  ES:'es',MX:'es',AR:'es',CO:'es',CL:'es',PE:'es',VE:'es',EC:'es',BO:'es',PY:'es',UY:'es',CR:'es',PA:'es',GT:'es',HN:'es',SV:'es',NI:'es',DO:'es',CU:'es',PR:'es',GQ:'es',
  // Portuguese
  BR:'pt',PT:'pt',AO:'pt',MZ:'pt',CV:'pt',GW:'pt',ST:'pt',TL:'pt',
  // Germanic and Nordic
  DE:'de',AT:'de',CH:'de',LI:'de',NL:'nl',BE:'nl',SR:'nl',SE:'sv',NO:'no',DK:'da',FI:'fi',IS:'is',
  // Other European
  IT:'it',SM:'it',VA:'it',GR:'el',CY:'el',TR:'tr',PL:'pl',CZ:'cs',SK:'sk',HU:'hu',RO:'ro',MD:'ro',BG:'bg',RS:'sr',ME:'sr',HR:'hr',SI:'sl',BA:'bs',
  MK:'mk',AL:'sq',XK:'sq',UA:'uk',LT:'lt',LV:'lv',EE:'et',RU:'ru',BY:'ru',KZ:'ru',KG:'ru',
  // Asia
  CN:'zh',TW:'zh',HK:'zh',MO:'zh',JP:'ja',KR:'ko',KP:'ko',VN:'vi',TH:'th',ID:'id',MY:'ms',BN:'ms',BD:'bn',NP:'ne',MM:'my',KH:'km',LA:'lo',MN:'mn',
  IR:'fa',AF:'fa',IL:'he',AZ:'az',AM:'hy',GE:'ka',UZ:'uz',TM:'tk',TJ:'tg',
};
export function countryLanguage(code: string): string { return LANG[code.toUpperCase()] ?? 'en'; }

/** Tavily `country` boost names (API reference, 10 Oct 2026). Others: no boost, country name in the query. */
const TAVILY = new Set(('afghanistan,albania,algeria,andorra,angola,argentina,armenia,australia,austria,azerbaijan,bahamas,bahrain,bangladesh,barbados,belarus,belgium,belize,benin,bhutan,bolivia,' +
  'bosnia and herzegovina,botswana,brazil,brunei,bulgaria,burkina faso,burundi,cambodia,cameroon,canada,cape verde,central african republic,chad,chile,china,colombia,comoros,congo,costa rica,' +
  'croatia,cuba,cyprus,czech republic,denmark,djibouti,dominican republic,ecuador,egypt,el salvador,equatorial guinea,eritrea,estonia,ethiopia,fiji,finland,france,gabon,gambia,georgia,germany,' +
  'ghana,greece,guatemala,guinea,haiti,honduras,hungary,iceland,india,indonesia,iran,iraq,ireland,israel,italy,jamaica,japan,jordan,kazakhstan,kenya,kuwait,kyrgyzstan,latvia,lebanon,lesotho,' +
  'liberia,libya,liechtenstein,lithuania,luxembourg,madagascar,malawi,malaysia,maldives,mali,malta,mauritania,mauritius,mexico,moldova,monaco,mongolia,montenegro,morocco,mozambique,myanmar,' +
  'namibia,nepal,netherlands,new zealand,nicaragua,niger,nigeria,north korea,north macedonia,norway,oman,pakistan,panama,papua new guinea,paraguay,peru,philippines,poland,portugal,qatar,' +
  'romania,russia,rwanda,saudi arabia,senegal,serbia,singapore,slovakia,slovenia,somalia,south africa,south korea,south sudan,spain,sri lanka,sudan,sweden,switzerland,syria,taiwan,tajikistan,' +
  'tanzania,thailand,togo,trinidad and tobago,tunisia,turkey,turkmenistan,uganda,ukraine,united arab emirates,united kingdom,united states,uruguay,uzbekistan,venezuela,vietnam,yemen,zambia,zimbabwe').split(','));
const TAVILY_FIX: Readonly<Record<string, string>> = { TR: 'turkey', CZ: 'czech republic', MM: 'myanmar', CD: 'congo', CG: 'congo', BS: 'bahamas', GM: 'gambia' };
export function tavilyCountry(code: string): string | null {
  const c = code.toUpperCase();
  const name = TAVILY_FIX[c] ?? COUNTRIES.find((x) => x.code === c)?.name.toLowerCase();
  return name && TAVILY.has(name) ? name : null;
}

/** Arab states have no English Bing News market of their own; "en-XA" (Arabia) is the regional English edition. */
const ARABIA = new Set(['AE', 'SA', 'QA', 'OM', 'KW', 'BH', 'JO', 'LB', 'IQ', 'YE', 'EG']);
/** English Bing News markets (Bing News market list). */
const EN_MARKETS = new Set(['AU', 'CA', 'GB', 'IE', 'IN', 'ID', 'MY', 'NZ', 'PH', 'SG', 'US', 'ZA']);
/** Bing News market for a country: local language first, English otherwise. */
export function bingMarket(code: string, lang: 'local' | 'en'): string {
  const c = code.toUpperCase();
  if (lang === 'local' && countryLanguage(c) !== 'en') return `${countryLanguage(c)}-${c}`;
  if (EN_MARKETS.has(c)) return `en-${c}`;
  return ARABIA.has(c) ? 'en-XA' : 'en-US';
}

export function gdeltCountry(code: string): string | null { return GDELT_FIPS[code.toUpperCase()] ?? null; }
