const MnfiExporter = (() => {

  // Michigan Natural Features Inventory element occurrence format
  async function generate(surveyId) {
    const obs    = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);

    // MNFI EO fields
    const header = [
      'EO_ID','SCIENTIFIC_NAME','COMMON_NAME','STATE_RANK','FEDERAL_STATUS',
      'SURVEY_DATE','OBSERVER','COUNTY','TOWNSHIP','SECTION',
      'LATITUDE_DD','LONGITUDE_DD','COORDINATE_ACCURACY_M',
      'POPULATION_SIZE','CONDITION','HABITAT_DESCRIPTION',
      'THREAT','NOTES','RARE_FLAG','ELEMENT_TYPE',
    ];

    const rareObs = obs.filter(o => o.lat && o.lng);

    const rows = rareObs.map(o => {
      const d    = new Date(o.observedAt || o.createdAt || Date.now());
      const date = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

      const elementType = _elementType(o.category);
      const popSize     = o.count > 1 ? String(o.count) : o.coveragePct ? o.coveragePct + '% cover' : '';

      return [
        '',
        o.scientificName || '',
        o.commonName     || '',
        '',
        '',
        date,
        survey?.surveyorName || '',
        survey?.county    || '',
        survey?.township  || '',
        '',
        o.lat.toFixed(7),
        o.lng.toFixed(7),
        o.accuracy ? Math.round(o.accuracy) : '',
        popSize,
        '',
        '',
        '',
        [o.notes, o.behavior, o.rareNotes].filter(Boolean).join('. '),
        o.isRare ? 'YES' : 'NO',
        elementType,
      ];
    });

    return [csvRow(header), ...rows.map(r => csvRow(r))].join('\r\n');
  }

  function _elementType(cat) {
    const map = {
      tree: 'Vascular Plant', shrub: 'Vascular Plant', herbaceous: 'Vascular Plant',
      'grass-sedge-rush': 'Vascular Plant', 'fern-moss-lichen': 'Vascular Plant',
      invasive: 'Vascular Plant', fungus: 'Fungus/Lichen',
      bird: 'Animal', mammal: 'Animal', reptile: 'Animal', amphibian: 'Animal',
      fish: 'Animal', invertebrate: 'Animal', 'sign-evidence': 'Animal',
    };
    return map[cat] || 'Unknown';
  }

  return { generate };
})();
