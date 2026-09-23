import { Directory, File, Paths } from "expo-file-system";

export function saveResearchFiles(params: {
  id: string;
  captureId: number;
  recording: Uint8Array;
  photoUri: string | null;
  metadata: Record<string, unknown>;
}) {
  const root = new Directory(Paths.document, "research-collections");
  root.create({ idempotent: true, intermediates: true });
  const folder = new Directory(root, params.id);
  folder.create({ idempotent: true, intermediates: true });

  const recordingFile = new File(folder, `skate-research-${params.captureId}.skateresearch`);
  recordingFile.create({ overwrite: true, intermediates: true });
  recordingFile.write(params.recording);

  const metadataFile = new File(folder, "metadata.json");
  metadataFile.create({ overwrite: true, intermediates: true });
  metadataFile.write(JSON.stringify(params.metadata, null, 2));

  let savedPhotoUri: string | null = null;
  if (params.photoUri) {
    const source = new File(params.photoUri);
    const photo = new File(folder, "surface.jpg");
    source.copy(photo);
    savedPhotoUri = photo.uri;
  }

  return { recordingUri: recordingFile.uri, photoUri: savedPhotoUri };
}
