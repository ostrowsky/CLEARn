// Помощник: фильтрует текст транскрипта по времени
interface TranscriptItem {
  text: string;
  start?: number;
  end?: number;
}

function filterTranscriptByTime(
  transcript: string | TranscriptItem[],
  startTime: number,
  endTime: number
): string {
  // Если это строка, не можем фильтровать без timestamps
  if (typeof transcript === 'string') {
    return transcript; // Возвращаем как есть
  }

  // Если массив с временными метками
  if (Array.isArray(transcript)) {
    const filtered = transcript.filter((item) => {
      const itemStart = typeof item.start === 'number' ? item.start : 0;
      const itemEnd = typeof item.end === 'number' ? item.end : Infinity;
      
      // Пересечение диапазонов
      return itemStart < (endTime || Infinity) && itemEnd > startTime;
    });

    return filtered.map(item => item.text).join(' ').trim();
  }

  return '';
}

function getMaterialTranscript(
  material: ContentMaterial,
  mediaUrl: string,
  startTime: number = 0,
  endTime: number = 0
) {
  const meta = asRecord(material.meta);
  const directTranscript = asString(meta.transcript) || asString(meta.videoTranscript) || asString(meta.caption);
  
  if (directTranscript.trim()) {
    // Если есть прямой текст, фильтруем по времени (если есть segments)
    const segments = Array.isArray(meta.transcriptSegments) ? meta.transcriptSegments : [];
    if (segments.length && startTime >= 0 && endTime > 0) {
      return filterTranscriptByTime(segments, startTime, endTime);
    }
    return directTranscript.trim();
  }

  // Пробуем сегменты
  const segments = Array.isArray(meta.transcriptSegments) ? meta.transcriptSegments : [];
  if (segments.length && startTime >= 0 && endTime > 0) {
    return filterTranscriptByTime(segments, startTime, endTime);
  }

  // Если ничего не нашли в данных, вернём null
  // чтобы VideoTranscript загрузил с API
  return null;
}

function VideoTranscript({
  mediaUrl,
  initialText,
  startTime = 0,
  endTime = 0
}: {
  mediaUrl: string;
  initialText: string | null;
  startTime?: number;
  endTime?: number;
}) {
  const [text, setText] = useState(initialText || '');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(initialText || '');
    setStatus('');
    setIsLoading(false);

    // Если уже есть текст, не загружаем
    if (initialText?.trim()) {
      return () => { cancelled = true; };
    }

    // Проверяем,是否YouTube видео
    const videoInfo = getYouTubeVideoInfo(mediaUrl);
    if (!videoInfo) {
      return () => { cancelled = true; };
    }

    setIsLoading(true);

    // ✅ ИСПРАВЛЕНИЕ: передаём параметры в правильном формате
    const params = new URLSearchParams();
    params.set('videoId', videoInfo.id); // ID видео
    if (startTime > 0) params.set('start', String(startTime));
    if (endTime > 0) params.set('end', String(endTime));

    apiClient
      .getVideoTranscript(videoInfo.id, {
        start: startTime > 0 ? startTime : undefined,
        end: endTime > 0 ? endTime : undefined,
      })
      .then((result) => {
        if (cancelled) return;

        let transcript = '';

        // Если результат это объект с текстом
        if (typeof result === 'object' && result.text) {
          transcript = String(result.text).trim();
        } else if (typeof result === 'string') {
          transcript = String(result).trim();
        } else if (Array.isArray(result)) {
          // Если результат массив (с временными метками)
          transcript = filterTranscriptByTime(result, startTime, endTime);
        }

        if (transcript) {
          setText(transcript);
          setStatus('');
        } else {
          setStatus('Транскрипт недоступен');
        }
      })
      .catch((error: Error) => {
        if (!cancelled) {
          console.error('Ошибка загрузки транскрипта:', error);
          setStatus(`Ошибка: ${error.message}`);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialText, mediaUrl, startTime, endTime]);

  if (!text && !status && !isLoading) {
    return null;
  }

  return (
    <View style={styles.transcriptBox}>
      <ScrollView nestedScrollEnabled>
        {isLoading ? (
          <ActivityIndicator color={tokens.colors.accentContrast} />
        ) : (
          <Text style={styles.transcriptText}>{text || status}</Text>
        )}
      </ScrollView>
    </View>
  );
}

function renderMaterial(material: ContentMaterial, options: {...}) {
  const mediaUrl = getMaterialUrl(material);

  // ✅ Извлекаем параметры
  const videoInfo = getYouTubeVideoInfo(mediaUrl);
  const startTime = videoInfo?.start ?? 0;
  const endTime = videoInfo?.end ?? 0;

  const embeddedVideoUrl = material.type === 'video' ? getEmbeddedVideoUrl(mediaUrl) : '';
  const isDirectVideo = material.type === 'video' && isDirectAsset(mediaUrl, directVideoPattern);
  const isDirectAudio = material.type === 'audio' && isDirectAsset(mediaUrl, directAudioPattern);
  const isDirectImage = material.type === 'image' && isDirectAsset(mediaUrl, directImagePattern);

  // ✅ ИСПРАВЛЕНИЕ: может вернуть null, если нужно загрузить с API
  const transcript = getMaterialTranscript(material, mediaUrl, startTime, endTime) || '';

  // ... остальной код

  if (isDirectVideo) {
    return (
      <View key={material.id} style={styles.materialCard}>
        <Text style={styles.materialLabel}>{material.title}</Text>
        <WebVideoPlayer url={mediaUrl} startTime={startTime} endTime={endTime} />
        {material.body ? <Text style={styles.materialBody}>{material.body}</Text> : null}
        <VideoTranscript 
          mediaUrl={mediaUrl} 
          initialText={transcript}  // Может быть пусто!
          startTime={startTime} 
          endTime={endTime} 
        />
        {Platform.OS !== 'web' ? <MaterialOpenButton url={mediaUrl} label={options.openMediaLabel} /> : null}
      </View>
    );
  }

  // ... остальной код
}
