const DwcExporter = (() => {

  async function generate(surveyId) {
    const obs    = await DB.getAllByIndex('observations', 'surveyId', surveyId);
    const survey = await DB.get('surveys', surveyId).catch(() => null);
    const now_   = new Date().toISOString();

    // ── occurrences.csv ───────────────────────────────────────────────────────
    const occHeader = [
      'occurrenceID','basisOfRecord','scientificName','vernacularName',
      'kingdom','phylum','class','order','family','genus',
      'taxonRank','eventDate','year','month','day',
      'decimalLatitude','decimalLongitude','coordinateUncertaintyInMeters',
      'individualCount','sex','lifeStage','occurrenceStatus',
      'occurrenceRemarks','recordedBy','datasetName','stateProvince','county',
    ];

    const occRows = obs
      .filter(o => o.lat && o.lng)
      .map(o => {
        const d   = new Date(o.observedAt || o.createdAt || Date.now());
        const iso = d.toISOString().slice(0, 10);
        const remarks = [
          o.notes,
          o.behavior  ? 'Behavior: '  + o.behavior  : null,
          o.signType  ? 'Sign: '      + o.signType   : null,
          o.heightM   ? 'Height: '    + metersToFeet(o.heightM) + ' ft' : null,
          o.dbhCm     ? 'DBH: '       + o.dbhCm + ' cm' : null,
          o.coveragePct ? 'Cover: '   + o.coveragePct : null,
          o.condition ? 'Condition: ' + o.condition  : null,
          o.tags?.length ? 'Tags: '   + o.tags.join(', ') : null,
          o.isRare    ? 'RARE/SIGNIFICANT' : null,
          o.rareNotes || null,
        ].filter(Boolean).join('. ');

        return [
          o.id, 'HumanObservation',
          o.scientificName || '', o.commonName || '',
          o.gbifKingdom || '', o.gbifPhylum || '', o.gbifClass || '',
          o.gbifOrder || '', o.gbifFamily || '', o.gbifGenus || '',
          o.gbifRank || 'SPECIES',
          iso, d.getFullYear(), d.getMonth() + 1, d.getDate(),
          o.lat.toFixed(7), o.lng.toFixed(7),
          o.accuracy ? Math.round(o.accuracy) : '',
          o.count || 1,
          o.sex || '',
          o.lifeStage || '',
          'PRESENT',
          remarks,
          survey?.surveyorName || '',
          survey?.name || '',
          'Michigan',
          survey?.county ? survey.county + ' County' : '',
        ];
      });

    const occCsv = [csvRow(occHeader), ...occRows.map(r => csvRow(r))].join('\r\n');

    // ── measurementOrFact.csv ─────────────────────────────────────────────────
    const mofHeader = ['id','occurrenceID','measurementType','measurementValue','measurementUnit','measurementDeterminedDate'];
    const mofRows = [];
    let mofSeq = 0;

    for (const o of obs) {
      const date = new Date(o.observedAt || o.createdAt || Date.now()).toISOString().slice(0, 10);
      if (o.heightM != null) {
        mofRows.push([`mof-${++mofSeq}`, o.id, 'height', o.heightM.toFixed(2), 'm', date]);
      }
      if (o.dbhCm != null) {
        mofRows.push([`mof-${++mofSeq}`, o.id, 'DBH', o.dbhCm, 'cm', date]);
      }
      if (o.coveragePct != null && o.coveragePct !== '') {
        mofRows.push([`mof-${++mofSeq}`, o.id, 'coverEstimate', String(o.coveragePct), 'class', date]);
      }
    }

    const mofCsv = [csvRow(mofHeader), ...mofRows.map(r => csvRow(r))].join('\r\n');

    // ── meta.xml ──────────────────────────────────────────────────────────────
    const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<archive xmlns="http://rs.tdwg.org/dwc/text/" metadata="eml.xml">
  <core encoding="UTF-8" fieldsTerminatedBy="," linesTerminatedBy="\\r\\n"
        fieldsEnclosedBy="&quot;" ignoreHeaderLines="1"
        rowType="http://rs.tdwg.org/dwc/terms/Occurrence">
    <files><location>occurrences.csv</location></files>
    <id index="0"/>
    <field index="1"  term="http://rs.tdwg.org/dwc/terms/basisOfRecord"/>
    <field index="2"  term="http://rs.tdwg.org/dwc/terms/scientificName"/>
    <field index="3"  term="http://rs.tdwg.org/dwc/terms/vernacularName"/>
    <field index="4"  term="http://rs.tdwg.org/dwc/terms/kingdom"/>
    <field index="5"  term="http://rs.tdwg.org/dwc/terms/phylum"/>
    <field index="6"  term="http://rs.tdwg.org/dwc/terms/class"/>
    <field index="7"  term="http://rs.tdwg.org/dwc/terms/order"/>
    <field index="8"  term="http://rs.tdwg.org/dwc/terms/family"/>
    <field index="9"  term="http://rs.tdwg.org/dwc/terms/genus"/>
    <field index="10" term="http://rs.tdwg.org/dwc/terms/taxonRank"/>
    <field index="11" term="http://rs.tdwg.org/dwc/terms/eventDate"/>
    <field index="12" term="http://rs.tdwg.org/dwc/terms/year"/>
    <field index="13" term="http://rs.tdwg.org/dwc/terms/month"/>
    <field index="14" term="http://rs.tdwg.org/dwc/terms/day"/>
    <field index="15" term="http://rs.tdwg.org/dwc/terms/decimalLatitude"/>
    <field index="16" term="http://rs.tdwg.org/dwc/terms/decimalLongitude"/>
    <field index="17" term="http://rs.tdwg.org/dwc/terms/coordinateUncertaintyInMeters"/>
    <field index="18" term="http://rs.tdwg.org/dwc/terms/individualCount"/>
    <field index="19" term="http://rs.tdwg.org/dwc/terms/sex"/>
    <field index="20" term="http://rs.tdwg.org/dwc/terms/lifeStage"/>
    <field index="21" term="http://rs.tdwg.org/dwc/terms/occurrenceStatus"/>
    <field index="22" term="http://rs.tdwg.org/dwc/terms/occurrenceRemarks"/>
    <field index="23" term="http://rs.tdwg.org/dwc/terms/recordedBy"/>
    <field index="24" term="http://rs.tdwg.org/dwc/terms/datasetName"/>
    <field index="25" term="http://rs.tdwg.org/dwc/terms/stateProvince"/>
    <field index="26" term="http://rs.tdwg.org/dwc/terms/county"/>
  </core>
  <extension encoding="UTF-8" fieldsTerminatedBy="," linesTerminatedBy="\\r\\n"
             fieldsEnclosedBy="&quot;" ignoreHeaderLines="1"
             rowType="http://rs.tdwg.org/dwc/terms/MeasurementOrFact">
    <files><location>measurementOrFact.csv</location></files>
    <coreid index="1"/>
    <field index="0"  term="http://rs.tdwg.org/dwc/terms/measurementID"/>
    <field index="2"  term="http://rs.tdwg.org/dwc/terms/measurementType"/>
    <field index="3"  term="http://rs.tdwg.org/dwc/terms/measurementValue"/>
    <field index="4"  term="http://rs.tdwg.org/dwc/terms/measurementUnit"/>
    <field index="5"  term="http://rs.tdwg.org/dwc/terms/measurementDeterminedDate"/>
  </extension>
</archive>`;

    // ── eml.xml ───────────────────────────────────────────────────────────────
    const emlXml = `<?xml version="1.0" encoding="UTF-8"?>
<eml:eml xmlns:eml="eml://ecoinformatics.org/eml-2.1.1"
         xmlns:dc="http://purl.org/dc/terms/"
         packageId="${surveyId}" system="field-survey">
  <dataset>
    <title>${_xmlEscape(survey?.name || 'Field Survey')}</title>
    <creator>
      <individualName><surName>${_xmlEscape(survey?.surveyorName || 'Unknown')}</surName></individualName>
    </creator>
    <pubDate>${now_.slice(0, 10)}</pubDate>
    <language>en</language>
    <abstract><para>Field survey observations from ${_xmlEscape(survey?.siteName || survey?.name || '')}. Survey date: ${survey?.startDate || ''}. ${survey?.notes ? _xmlEscape(survey.notes) : ''}</para></abstract>
    <coverage>
      <geographicCoverage>
        <geographicDescription>${_xmlEscape([survey?.siteName, survey?.county ? survey.county + ' County' : '', 'Michigan'].filter(Boolean).join(', '))}</geographicDescription>
      </geographicCoverage>
    </coverage>
  </dataset>
</eml:eml>`;

    const zip = new JSZip();
    zip.file('occurrences.csv',       occCsv);
    zip.file('measurementOrFact.csv', mofCsv);
    zip.file('meta.xml',              metaXml);
    zip.file('eml.xml',               emlXml);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/zip' });
  }

  function _xmlEscape(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  return { generate };
})();
