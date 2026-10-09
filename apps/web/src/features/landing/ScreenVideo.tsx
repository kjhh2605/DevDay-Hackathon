import { useEffect, useRef, useState } from 'react';
import s from './LandingPage.module.css';

export function ScreenVideo({
  name,
  title,
  priority = false,
}: {
  name: string;
  title: string;
  priority?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(priority);
  const [visible, setVisible] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [intent, setIntent] = useState<'auto' | 'play' | 'pause'>('auto');
  const programmaticEvents = useRef<Array<'play' | 'pause'>>([]);
  const [failed, setFailed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        const inView = entry.isIntersecting && entry.intersectionRatio >= 0.2;
        setVisible(inView);
        if (entry.isIntersecting) setReady(true);
      },
      { threshold: [0, 0.2] },
    );
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const sync = () => {
      const element = video.current;
      if (!element) return;
      const shouldPlay =
        ready &&
        visible &&
        intent !== 'pause' &&
        (!reducedMotion || intent === 'play') &&
        !document.hidden;
      if (shouldPlay && element.paused) {
        programmaticEvents.current.push('play');
        void element.play().catch(() => {
          programmaticEvents.current = programmaticEvents.current.filter(
            (event) => event !== 'play',
          );
        });
      } else if (!shouldPlay && !element.paused) {
        programmaticEvents.current.push('pause');
        element.pause();
      }
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [ready, visible, reducedMotion, intent]);

  const onPlayback = (event: 'play' | 'pause') => {
    setPlaying(event === 'play');
    const index = programmaticEvents.current.indexOf(event);
    if (index >= 0) programmaticEvents.current.splice(index, 1);
    else setIntent(event);
  };

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      setIntent('play');
      void element.play().catch(() => {});
    } else {
      setIntent('pause');
      element.pause();
    }
  };

  return (
    <div className={s.videoShell} ref={container}>
      <video
        ref={video}
        className={s.video}
        src={ready ? `/media/landing/${name}.mp4` : undefined}
        poster={`/media/landing/${name}.jpg`}
        aria-label={title}
        preload={priority ? 'metadata' : 'none'}
        width="1600"
        height="900"
        muted
        loop
        playsInline
        controls
        onPlay={() => onPlayback('play')}
        onPause={() => onPlayback('pause')}
        onLoadedData={() => setFailed(false)}
        onError={() => setFailed(true)}
      >
        <track kind="captions" src={`/media/landing/${name}.vtt`} srcLang="ko" label="한국어" />이
        브라우저에서는 영상을 재생할 수 없습니다.
      </video>
      <div className={s.videoToolbar}>
        <span className={s.videoLabel}>
          <span className={playing ? s.playingDot : s.videoDot} />
          {priority ? '말모아, 이렇게 사용해요' : '실제 서비스 화면'}
        </span>
        {failed ? (
          <a className={s.videoControl} href={`/media/landing/${name}.mp4`}>
            영상 파일 열기 ↗
          </a>
        ) : (
          <button
            type="button"
            className={s.videoControl}
            onClick={toggle}
            aria-label={`${title} ${playing ? '일시정지' : '재생'}`}
          >
            <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>
            {playing ? '일시정지' : '영상 재생'}
          </button>
        )}
      </div>
    </div>
  );
}
