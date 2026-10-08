import type {TableRow} from '@/mvp/crm/contracts';
/** CSV quoting alone does not stop spreadsheet formula injection. */
export function csvCell(value:unknown):string {
  let text=value===null||value===undefined?'':String(value);
  if(/^[\s]*[=+@-]|^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
}
export function tableCsv(rows:TableRow[]):string {
  return [['Company','Activity / role','Trigger','Date','Value','Operating country','Searched product','Contact status'],...rows.map(r=>
    'slotId' in r?[r.companyName,r.person?.title??r.title,'','','','','',r.validated?'Validated':r.person?'Likely':'Not found']:
      'linkedToCompanyId' in r?[r.name,r.supplies,r.link,'','',r.country,r.sellSummary,`${r.contactsFound}/${r.contactsTotal}`]:
        [r.name,r.whatTheyDo,r.trigger?.title,r.trigger?.date,r.trigger?.valueText,r.operatingCountry,r.sellSummary,`${r.contactsFound}/${r.contactsTotal}`])]
    .map(row=>row.map(csvCell).join(',')).join('\r\n');
}
