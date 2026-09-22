import type { PublicationProfile, ScormStandard } from "@studio/schema";
import { escapeXml, xmlId } from "./xml.js";

export type ManifestInput = {
  standard: ScormStandard;
  profile: PublicationProfile;
  projectId: string;
  title: string;
  description?: string;
  launch: string;
  files: string[];
  /** Hay evaluaciones reales que calculan aprobación (Fase 5). */
  hasScoring: boolean;
};

const indent = (n: number) => "  ".repeat(n);

function fileList(files: string[], depth: number): string {
  return files.map((f) => `${indent(depth)}<file href="${escapeXml(f)}"/>`).join("\n");
}

/**
 * imsmanifest.xml para SCORM 1.2 (IMS CP 1.1.2 + ADL CP 1.2).
 * Un único SCO que lanza index.html y declara todos los archivos.
 */
export function buildManifest12(i: ManifestInput): string {
  const man = xmlId("MANIFEST", i.projectId);
  const org = xmlId("ORG", i.projectId);
  const res = xmlId("RES", i.projectId);
  const item = xmlId("ITEM", i.projectId);
  const mastery =
    i.hasScoring && i.profile.passing.enabled
      ? `\n${indent(4)}<adlcp:masteryscore>${Math.round(i.profile.passing.threshold)}</adlcp:masteryscore>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${man}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}">
      <title>${escapeXml(i.title)}</title>
      <item identifier="${item}" identifierref="${res}" isvisible="true">
        <title>${escapeXml(i.title)}</title>${mastery}
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="${res}" type="webcontent" adlcp:scormtype="sco" href="${escapeXml(i.launch)}">
${fileList(i.files, 3)}
    </resource>
  </resources>
</manifest>
`;
}

/**
 * imsmanifest.xml para SCORM 2004 4th Edition.
 * Perfil Moodle: sin reglas de secuenciación (Moodle las soporta parcialmente).
 * Perfil genérico: controlMode choice+flow explícito.
 */
export function buildManifest2004(i: ManifestInput): string {
  const man = xmlId("MANIFEST", i.projectId);
  const org = xmlId("ORG", i.projectId);
  const res = xmlId("RES", i.projectId);
  const item = xmlId("ITEM", i.projectId);
  const passing = i.hasScoring && i.profile.passing.enabled;
  const itemSeq = passing
    ? `
${indent(4)}<imsss:sequencing>
${indent(5)}<imsss:objectives>
${indent(6)}<imsss:primaryObjective objectiveID="PRIMARYOBJ" satisfiedByMeasure="true">
${indent(7)}<imsss:minNormalizedMeasure>${(i.profile.passing.threshold / 100).toFixed(2)}</imsss:minNormalizedMeasure>
${indent(6)}</imsss:primaryObjective>
${indent(5)}</imsss:objectives>
${indent(4)}</imsss:sequencing>`
    : "";
  const orgSeq =
    i.profile.lms === "generic"
      ? `
${indent(3)}<imsss:sequencing>
${indent(4)}<imsss:controlMode choice="true" flow="true"/>
${indent(3)}</imsss:sequencing>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${man}" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 4th Edition</schemaversion>
  </metadata>
  <organizations default="${org}">
    <organization identifier="${org}">
      <title>${escapeXml(i.title)}</title>
      <item identifier="${item}" identifierref="${res}" isvisible="true">
        <title>${escapeXml(i.title)}</title>${itemSeq}
      </item>${orgSeq}
    </organization>
  </organizations>
  <resources>
    <resource identifier="${res}" type="webcontent" adlcp:scormType="sco" href="${escapeXml(i.launch)}">
${fileList(i.files, 3)}
    </resource>
  </resources>
</manifest>
`;
}

export function buildManifest(i: ManifestInput): string {
  return i.standard === "scorm12" ? buildManifest12(i) : buildManifest2004(i);
}
