import path from 'node:path';
import fs from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const skill=process.env.PRESENTATIONS_SKILL_DIR;
const python=process.env.RUNTIME_PYTHON;
if(!skill || !python) throw new Error('Set PRESENTATIONS_SKILL_DIR and RUNTIME_PYTHON');
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')));
const build=path.join(root,'.local/presentation/aws-landing-revision');
const result=await finalizePresentation({
  workspaceDir:root,candidatePath:path.join(build,'candidate-animated.pptx'),
  finalPath:path.join(root,'docs/presentation/output/말모아_10분_프로젝트발표_AWS_디자인개선.pptx'),
  explicitTotalSlideCount:13,requiredNativeTableOwnerSlides:[7,12,13],requiredNativeChartOwnerSlides:[],
  pythonExecutable:python,
  integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',
    '--require-native-table-slide','7','--require-native-table-slide','12','--require-native-table-slide','13'],
  fontPolicy:{basis:'design',families:['Pretendard']},verifyArtifactToolImport:true,
  receiptPath:path.join(build,'final-validation-v2.json'),
});
console.log(JSON.stringify(result));
