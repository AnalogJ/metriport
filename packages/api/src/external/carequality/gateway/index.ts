import { Patient } from "@metriport/core/domain/patient";
import { out } from "@metriport/core/util/log";
import { XCPDGateway } from "@metriport/ihe-gateway-sdk";
import { MetriportError } from "@metriport/shared";
import { CQDirectoryEntry } from "../cq-directory";
import { Config } from "../../../shared/config";
import { isE2eCx, isEpicEnabledForCx } from "../../aws/app-config";
import { getCQDirectoryEntryOrFail } from "../command/cq-directory/get-cq-directory-entry";
import { getOrganizationsForXCPD } from "../command/cq-directory/get-organizations-for-xcpd";
import {
  filterCQOrgsToSearch,
  searchCQDirectoriesAroundPatientAddresses,
  toBasicOrgAttributes,
} from "../command/cq-directory/search-cq-directory";
import { buildXcpdGateway, cqOrgsToXCPDGateways } from "../organization-conversion";

type Gateways = {
  v1Gateways: XCPDGateway[];
  v2Gateways: XCPDGateway[];
};

export const EPIC_ORG_NAME = "Epic";

export async function gatherXCPDGateways(patient: Patient): Promise<Gateways> {
  const { log } = out(`gatherXCPDGateways, cx ${patient.cxId}, patient ${patient.id}`);

  /**
   * This is dedicated to E2E testing: limits the XCPD to the System Root's E2E Gateway.
   * Avoid this approach as much as possible.
   */
  const isE2e = await isE2eCx(patient.cxId);
  if (isE2e) {
    log("Limiting to E2E Gateways");
    return getE2eGateways();
  }

  const isEpicEnabled = await isEpicEnabledForCx(patient.cxId);

  const nearbyOrgsWithUrls = await searchCQDirectoriesAroundPatientAddresses({
    patient,
    mustHaveXcpdLink: true,
  });
  const orgOrderMap = new Map<string, number>();

  nearbyOrgsWithUrls.forEach((org, index) => {
    orgOrderMap.set(org.id, index);
  });

  const allOrgs = await getOrganizationsForXCPD(orgOrderMap);
  const filteredOrgs = facilitiesWithEpicFilter(allOrgs, isEpicEnabled);
  const allOrgsWithBasics = filteredOrgs.map(toBasicOrgAttributes);
  const orgsToSearch = filterCQOrgsToSearch(allOrgsWithBasics);
  const { v1Gateways, v2Gateways } = await cqOrgsToXCPDGateways(orgsToSearch, patient.cxId);

  return {
    v1Gateways,
    v2Gateways,
  };
}

export function facilitiesWithEpicFilter(
  cqDirectoryEntries: CQDirectoryEntry[],
  isEpicEnabled: boolean
): CQDirectoryEntry[] {
  return isEpicEnabled
    ? cqDirectoryEntries
    : cqDirectoryEntries.filter(
        entry => entry.managingOrganization?.trim().toLowerCase() !== EPIC_ORG_NAME.toLowerCase()
      );
}

async function getE2eGateways(): Promise<Gateways> {
  const e2eCqDirectoryEntry = await getCQDirectoryEntryOrFail(Config.getSystemRootOID());
  if (!e2eCqDirectoryEntry.urlXCPD) {
    throw new MetriportError("E2E CQ Directory entry missing XCPD URL", undefined, {
      id: e2eCqDirectoryEntry.id,
    });
  }
  const e2eXcpdGateway = buildXcpdGateway({
    urlXCPD: e2eCqDirectoryEntry.urlXCPD,
    id: e2eCqDirectoryEntry.id,
  });
  return {
    v1Gateways: [],
    v2Gateways: [e2eXcpdGateway],
  };
}
