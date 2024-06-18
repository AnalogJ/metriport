import { XCPDGateway, OutboundPatientDiscoveryReq } from "@metriport/ihe-gateway-sdk";
import { errorToString } from "../../../../../../util/error/shared";
import { SamlCertsAndKeys } from "../../../saml/security/types";
import { SamlClientResponse, sendSignedXml } from "../../../saml/saml-client";
import { BulkSignedXCPD } from "../create/iti55-envelope";
import { out } from "../../../../../../util/log";
import { storeXcpdResponses } from "../../../monitor/store";

const { log } = out("Sending XCPD Requests");

export type XCPDSamlClientResponse = SamlClientResponse & {
  gateway: XCPDGateway;
  outboundRequest: OutboundPatientDiscoveryReq;
};

export async function sendSignedXCPDRequests({
  signedRequests,
  samlCertsAndKeys,
  patientId,
  cxId,
}: {
  signedRequests: BulkSignedXCPD[];
  samlCertsAndKeys: SamlCertsAndKeys;
  patientId: string;
  cxId: string;
}): Promise<XCPDSamlClientResponse[]> {
  const requestPromises = signedRequests.map(async (request, index) => {
    try {
      const { response } = await sendSignedXml({
        signedXml: request.signedRequest,
        url: request.gateway.url,
        samlCertsAndKeys,
      });
      log(
        `Request ${index + 1} sent successfully to: ${request.gateway.url} + oid: ${
          request.gateway.oid
        }`
      );
      await storeXcpdResponses({
        response,
        outboundRequest: request.outboundRequest,
        gateway: request.gateway,
      });
      return {
        gateway: request.gateway,
        response,
        success: true,
        outboundRequest: request.outboundRequest,
      };
      //eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      const msg = "HTTP/SSL Failure Sending Signed XCPD SAML Request";
      log(
        `${msg}, cxId: ${cxId}, patientId: ${patientId}, gateway: ${request.gateway.oid}, error: ${error}`
      );
      if (error?.response?.data) {
        log(`error details: ${JSON.stringify(error?.response?.data)}`);
      }

      const errorString: string = errorToString(error);
      return {
        gateway: request.gateway,
        outboundRequest: request.outboundRequest,
        response: errorString,
        success: false,
      };
    }
  });

  return await Promise.all(requestPromises);
}
