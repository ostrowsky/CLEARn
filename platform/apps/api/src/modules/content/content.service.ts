import type { AppContent } from '@softskills/domain';
import type { ContentRepository } from './content.repository';
import type { MediaStore } from './media.store';

export class ContentService {
  constructor(
    private readonly repository: ContentRepository,
    private readonly mediaStore: MediaStore,
  ) {}

  getContent(): Promise<AppContent> {
    return this.repository.get();
  }

  saveContent(content: AppContent): Promise<AppContent> {
    return this.repository.save(content);
  }

  uploadMedia(fileName: string, base64: string) {
    return this.mediaStore.upload({ fileName, base64 });
  }

  deleteMedia(url: string) {
    return this.mediaStore.delete(url);
  }
}
