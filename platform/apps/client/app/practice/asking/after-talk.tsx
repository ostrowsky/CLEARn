import { useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/Screen';
import { AskAfterComposer } from '../../../src/components/practice/AskAfterComposer';
import { useContent } from '../../../src/hooks/useContent';
import {
  findFirstBlockByRenderer,
  getBlockGroupConfig,
  getNestedString,
  getPracticeScreenConfig,
  getSectionByRoute,
  getUiConfig,
} from '../../../src/lib/contentMeta';

export default function AskAfterPracticeScreen() {
  const { sectionId, blockId } = useLocalSearchParams<{ sectionId?: string; blockId?: string }>();
  const { content } = useContent();
  const ui = getUiConfig(content);
  const practiceConfig = getPracticeScreenConfig(content, 'askAfter');
  const blockGroup = getBlockGroupConfig(content, 'askAfter');
  const sectionRoute = getNestedString(practiceConfig, ['sectionRoute']) || getNestedString(blockGroup, ['sectionRoute']);
  const practiceRenderer = getNestedString(practiceConfig, ['blockRenderer']);
  const section = sectionId
    ? (content?.sections.find((item) => item.id === sectionId) || null)
    : (getSectionByRoute(content, sectionRoute) || null);
  const practiceBlock = blockId
    ? (section?.blocks.find((block) => block.id === blockId) || findFirstBlockByRenderer(content, section || undefined, practiceRenderer))
    : findFirstBlockByRenderer(content, section || undefined, practiceRenderer);

  return (
    <Screen
      appTitle={content?.meta.appTitle}
      brandTagline={getNestedString(ui, ['brandTagline'])}
      footerNote={getNestedString(ui, ['footerNote'])}
      eyebrow={section?.eyebrow}
      title={practiceBlock?.title ?? section?.title ?? ''}
      subtitle={practiceBlock?.description ?? section?.summary ?? ''}
      backHref={section ? `/section/${section.id}` : '/sections'}
      backLabel={section?.title ?? getNestedString(ui, ['navigation', 'backToHome'])}
    >
      <AskAfterComposer content={content} section={section || undefined} practiceBlock={practiceBlock || undefined} />
    </Screen>
  );
}