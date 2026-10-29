import { Composition } from 'remotion';
import { DURATION, Intro } from './Intro';

export const RemotionRoot = () => (
  <>
    <Composition id="intro-en" component={Intro} durationInFrames={DURATION} fps={30} width={1920} height={1080} defaultProps={{ locale: 'en' as const }} />
    <Composition id="intro-zh-TW" component={Intro} durationInFrames={DURATION} fps={30} width={1920} height={1080} defaultProps={{ locale: 'zh-TW' as const }} />
  </>
);
