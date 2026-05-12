const InatExporter = (() => {

  // iNaturalist CSV upload format
  // https://www.inaturalist.org/observations/upload
  async function generate(surveyId) {
    const obs = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);

    const header = ['taxon_name','observed_on','time_observed_at','description','latitude','longitude',
                    'positional_accuracy','place_guess','tag_list','geoprivacy'];

    const rows = obs
      .filter(o => o.scientificName && o.lat && o.lng)
      .map(o => {
        const d    = new Date(o.observedAt || o.createdAt || Date.now());
        const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
        const time = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:00`;

        const parts = [];
        if (o.notes)       parts.push(o.notes);
        if (o.behavior)    parts.push(o.behavior);
        if (o.signType)    parts.push('Sign: ' + o.signType);
        if (o.count > 1)   parts.push('Count: ' + o.count);
        if (o.heightM)     parts.push('Height: ' + metersToFeet(o.heightM) + ' ft');
        if (o.dbhCm)       parts.push('DBH: ' + o.dbhCm + ' cm');
        if (o.coveragePct != null) parts.push('Coverage: ' + o.coveragePct + '%');
        if (o.isRare)      parts.push('RARE/SIGNIFICANT');
        if (o.rareNotes)   parts.push('Rare notes: ' + o.rareNotes);
        if (survey?.surveyorName) parts.push('Surveyor: ' + survey.surveyorName);

        const tags = [o.category, survey?.name].filter(Boolean).join(',');
        const placeGuess = [survey?.siteName, survey?.county ? survey.county + ' County, Michigan' : 'Michigan']
          .filter(Boolean).join(', ');

        return [
          o.scientificName,
          date,
          time,
          parts.join('. '),
          o.lat.toFixed(7),
          o.lng.toFixed(7),
          o.accuracy ? Math.round(o.accuracy) : '',
          placeGuess,
          tags,
          o.isRare ? 'obscured' : 'open',
        ];
      });

    return [csvRow(header), ...rows.map(r => csvRow(r))].join('\r\n');
  }

  return { generate };
})();
