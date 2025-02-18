import { Observation, ObservationComponent } from "@medplum/fhirtypes";
import {
  CdaCodeCv,
  CdaInstanceIdentifier,
  CdaValuePq,
  CdaValueSt,
  Entry,
  EntryObject,
  ObservationEntry,
  ObservationEntryRelationship,
  ObservationTableRow,
} from "../../cda-types/shared-types";
import {
  TIMESTAMP_CLEANUP_REGEX,
  buildCodeCe,
  buildCodeCvFromCodeableConcept,
  buildInstanceIdentifier,
  buildReferenceId,
  buildValueSt,
  formatDateToCdaTimestamp,
  formatDateToHumanReadableFormat,
  isLoinc,
  withoutNullFlavorObject,
} from "../commons";
import {
  _xsiTypeAttribute,
  extensionValue2015,
  loincCodeSystem,
  loincSystemName,
  oids,
  placeholderOrgOid,
} from "../constants";
import { AugmentedObservation } from "./augmented-resources";

export interface CdaObservation {
  component: {
    observation: {
      _classCode: Entry;
      _moodCode: Entry;
      id?: CdaInstanceIdentifier[] | Entry;
      code: CdaCodeCv | undefined;
      text?: Entry;
      statusCode?: EntryObject;
      effectiveTime?: {
        low?: EntryObject;
        high?: EntryObject;
      };
      priorityCode?: Entry;
      value?: CdaValueSt | undefined;
    };
  };
}

export function createObservations(observations: Observation[]): CdaObservation[] {
  return observations.map(observation => {
    const effectiveTime = observation.effectiveDateTime?.replace(TIMESTAMP_CLEANUP_REGEX, "");
    return {
      component: {
        observation: {
          _classCode: "OBS",
          _moodCode: "EVN",
          templateId: buildInstanceIdentifier({
            root: oids.resultObs,
            extension: extensionValue2015,
          }),
          id: {
            _root: placeholderOrgOid,
            _extension: observation.id ?? observation.identifier?.[0]?.value ?? "",
          },
          code: buildCodeCvFromCodeableConcept(observation.code),
          statusCode: withoutNullFlavorObject(observation.status, "_code"),
          effectiveTime: {
            low: withoutNullFlavorObject(effectiveTime, "_value"),
            high: withoutNullFlavorObject(effectiveTime, "_value"),
          },
          value: buildValueSt(observation.valueString),
        },
      },
    };
  });
}

export function createTableRowsFromObservation(
  observation: AugmentedObservation,
  socHistPrefix: string
): ObservationTableRow[] {
  const date = formatDateToCdaTimestamp(observation.resource.effectiveDateTime);
  const trs: ObservationTableRow[] = [];
  const formattedDate = formatDateToHumanReadableFormat(date);
  let pairNumber = 0;
  if (observation.resource.component && observation.resource.component.length > 0) {
    const componentTrs = observation.resource.component.flatMap(pair => {
      pairNumber++;
      return createTableRowFromObservation(
        pair,
        buildReferenceId(socHistPrefix, pairNumber),
        formattedDate
      );
    });
    trs.push(...componentTrs);
  }
  if (hasObservationInCode(observation.resource)) {
    pairNumber++;
    trs.push(
      createTableRowFromObservation(
        observation.resource,
        buildReferenceId(socHistPrefix, pairNumber),
        formattedDate
      )
    );
  }
  return trs;
}

export function createTableRowFromObservation(
  observation: Observation | ObservationComponent,
  referenceId: string,
  date: string | undefined
): ObservationTableRow {
  const interpretation = observation.interpretation;
  const score = interpretation?.[0]?.coding?.[0]?.display;
  const intValue = score ? parseInt(score) : undefined;
  const scoreValue = intValue != undefined && !isNaN(intValue) ? intValue.toString() : "N/A";

  return {
    tr: {
      _ID: referenceId,
      ["td"]: [
        {
          "#text": observation.code?.coding?.[0]?.display ?? observation.code?.text,
        },
        {
          "#text":
            observation.valueCodeableConcept?.coding?.[0]?.display ??
            observation.valueCodeableConcept?.text ??
            "Not on file",
        },
        {
          "#text": scoreValue,
        },
        {
          "#text": date ?? "Unknown",
        },
      ],
    },
  };
}

export function hasObservationInCode(observation: Observation): boolean {
  return (
    (observation.code?.coding &&
      observation.code.coding.length > 0 &&
      observation.valueCodeableConcept?.coding &&
      observation.valueCodeableConcept.coding.length > 0) ??
    false
  );
}

export function createEntriesFromObservation(
  observation: AugmentedObservation,
  socHistNumber: string
): ObservationEntry {
  let pairNumber = 0;
  const date = formatDateToCdaTimestamp(observation.resource.effectiveDateTime);
  const observationEntry = createEntryFromObservation(
    observation.resource,
    observation,
    socHistNumber,
    date
  );
  observationEntry.observation.entryRelationship = [];

  if (observation.resource.component && observation.resource.component.length > 0) {
    observation.resource.component.map(pair => {
      pairNumber++;
      const entryRelationshipObservation = createEntryFromObservation(
        pair,
        observation,
        buildReferenceId(socHistNumber, pairNumber),
        date
      );
      const entryRelationship = createEntryRelationship(entryRelationshipObservation);
      if (observationEntry.observation.entryRelationship) {
        observationEntry.observation.entryRelationship.push(entryRelationship);
      }
    });
  }

  return observationEntry;
}

function createEntryFromObservation(
  observation: Observation | ObservationComponent,
  augObs: AugmentedObservation,
  referenceId: string,
  date?: string
): ObservationEntry {
  const codeSystem = observation.code?.coding?.[0]?.system;
  const systemIsLoinc = isLoinc(codeSystem);
  const entry = {
    observation: {
      _classCode: "OBS",
      _moodCode: "EVN",
      templateId: buildInstanceIdentifier({
        root: augObs.typeOid,
        extension: extensionValue2015,
      }),
      id: buildInstanceIdentifier({
        root: placeholderOrgOid,
        extension: observation.id ?? augObs.resource.id,
      }),
      code: buildCodeCe({
        code: observation.code?.coding?.[0]?.code,
        codeSystem: systemIsLoinc ? loincCodeSystem : codeSystem,
        codeSystemName: systemIsLoinc ? loincSystemName : undefined,
        displayName: observation.code?.coding?.[0]?.display,
      }),
      text: {
        reference: {
          _value: referenceId,
        },
      },
      statusCode: {
        _code: "completed",
      },
      effectiveTime: withoutNullFlavorObject(date, "_value"),
      value: buildValue(observation),
      interpretationCode: buildCodeCe({
        code: observation.interpretation?.[0]?.coding?.[0]?.code,
        codeSystem: observation.interpretation?.[0]?.coding?.[0]?.system,
        codeSystemName: observation.interpretation?.[0]?.coding?.[0]?.display,
        displayName: observation.interpretation?.[0]?.coding?.[0]?.display,
      }),
    },
  };
  return entry;
}

function buildValue(observation: Observation | ObservationComponent): CdaValuePq | undefined {
  if (observation.valueQuantity?.value == undefined) return undefined;

  return {
    [_xsiTypeAttribute]: "PQ",
    _unit: observation.valueQuantity?.unit,
    _value: observation.valueQuantity?.value,
  };
}

function createEntryRelationship(entry: ObservationEntry): ObservationEntryRelationship {
  return {
    _typeCode: "COMP",
    observation: {
      ...entry.observation,
    },
  };
}
