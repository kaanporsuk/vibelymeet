import { Image as ExpoImage } from 'expo-image';
import { StyleSheet, View, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import {
  normalizeMediaPlaceholderDominantColor,
  normalizeMediaPlaceholderHash,
  normalizeMediaPlaceholderKind,
  type MediaPlaceholderKind,
} from '@clientShared/media/placeholders';

type MediaPlaceholderProps = {
  kind?: MediaPlaceholderKind | null;
  hash?: string | null;
  dominantColor?: string | null;
  style?: StyleProp<ViewStyle>;
};

export function MediaPlaceholder({
  kind,
  hash,
  dominantColor,
  style,
}: MediaPlaceholderProps) {
  const normalizedKind = normalizeMediaPlaceholderKind(kind);
  const normalizedHash = normalizeMediaPlaceholderHash(normalizedKind, hash);
  const backgroundColor = normalizeMediaPlaceholderDominantColor(
    normalizedKind,
    normalizedHash,
    dominantColor,
  ) ?? 'rgba(24,24,32,0.92)';
  const imageStyle = style as StyleProp<ImageStyle>;

  if (normalizedKind === 'blurhash' && normalizedHash) {
    return (
      <ExpoImage
        pointerEvents="none"
        placeholder={{ blurhash: normalizedHash }}
        contentFit="cover"
        style={[StyleSheet.absoluteFillObject, { backgroundColor }, imageStyle]}
      />
    );
  }

  return <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor }, style]} />;
}
