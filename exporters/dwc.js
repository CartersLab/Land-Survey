const DwcExporter = (() => {

  // Darwin Core Simple CSV (GBIF-compatible)
  async function generate(surveyId) {
    const obs    = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);

    const header = [
      'occurrenceID','basisOfRecord','scientificName','vernacularName',
      'kingdom','phylum','class','order','family','genus',
      'taxonRank','eventDate','year','month','day',
      'decimalLatitude','decimalLongitude','coordinateUncertaintyInMeters',
      'individualCount','occurrenceRemarks','recordedBy',
      'datasetName','stateProvince','county',
      'occurrenceStatus','occurrenceID',
    ];

    const rows = obs
      .filter(o => o.lat && o.lng)
      .map(o => {
        const d   = new Date(o.observedAt || o.createdAt || Date.now());
        const iso = d.toISOString().slice(0, 10);

        const remarks = [
          o.notes,
          o.behavior  ? 'Behavior: ' + o.behavior  : null,
          o.signType  ? 'Sign: ' + o.signType       : null,
          o.heightM   ? 'Height: ' + metersToFeet(o.heightM) + ' ft' : null,
          o.dbhCm     ? 'DBH: ' + o.dbhCm + ' cm'  : null,
          o.isRare    ? 'RARE/SIGNIFICANT'           : null,
          o.rareNotes || null,
        ].filter(Boolean).join('. ');

        return [
          o.id,
          'HumanObservation',
          o.scientificName || '',
          o.commonName     || '',
          o.gbifKingdom || '',
          o.gbifPhylum  || '',
          o.gbifClass   || '',
          o.gbifOrder   || '',
          o.gbifFamily  || '',
          o.gbifGenus   || '',
          o.gbifRank    || 'SPECIES',
          iso,
          d.getFullYear(),
          d.getMonth() + 1,
          d.getDate(),
          o.lat.toFixed(7),
          o.lng.toFixed(7),
          o.accuracy ? Math.round(o.accuracy) : '',
          o.count || 1,
          remarks,
          survey?.surveyorName || '',
          survey?.name || '',
          'Michigan',
          survey?.county ? survey.county + ' County' : '',
          'PRESENT',
          o.id,
        ];
      });

    return [csvRow(header), ...rows.map(r => csvRow(r))].join('\r\n');
  }

  return { generate };
})();
