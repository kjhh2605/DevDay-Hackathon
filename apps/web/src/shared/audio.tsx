import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { createCaptureController } from '@devday/audio-client';
import type { CaptureState } from '@devday/audio-client';
import type { StudySnapshot } from '@devday/contracts';
import { useUserEvent } from './events';

type Controller = ReturnType<typeof createCaptureController>;
type State = CaptureState;
type AudioContextValue = {
  state: State;
  enabled: boolean;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
};
const MicContext = createContext<AudioContextValue>({
  state: { status: 'idle', topicId: null },
  enabled: false,
  enable: async () => {},
  disable: async () => {},
});
export const useMicrophone = () => useContext(MicContext);
export function MicrophoneProvider({
  snapshot,
  children,
}: { snapshot: StudySnapshot | null } & PropsWithChildren) {
  const [state, setState] = useState<State>({ status: 'idle', topicId: null });
  const [enabled, setEnabled] = useState(false);
  const controller = useRef<Controller | null>(null);
  const lastTopic = useRef<string | null>(null);
  useEffect(() => {
    const capture = createCaptureController({
      onState: (value) => {
        setState(value);
      },
    });
    controller.current = capture;
    return () => {
      controller.current = null;
      void capture.stopCapture().catch(() => undefined);
    };
  }, []);
  const enable = useCallback(async () => {
    if (!snapshot?.topic || snapshot.topic.state !== 'talking') return;
    lastTopic.current = snapshot.topic.id;
    setEnabled(true);
    try {
      await controller.current?.startCapture(snapshot.topic.id);
    } catch {
      /* capture state exposes the failure; user intent is retained */
    }
  }, [snapshot?.topic]);
  const disable = useCallback(async () => {
    setEnabled(false);
    lastTopic.current = null;
    try {
      await controller.current?.stopCapture();
    } catch {
      /* onState supplies the visible microphone error. */
    }
  }, []);
  useEffect(() => {
    const topic = snapshot?.topic;
    if (enabled && topic?.state === 'talking' && topic.id !== lastTopic.current) {
      lastTopic.current = topic.id;
      void controller.current?.startCapture(topic.id).catch(() => undefined);
    }
    if (snapshot?.study.status === 'ended') void disable();
  }, [enabled, snapshot?.topic?.id, snapshot?.topic?.state, snapshot?.study.status, disable]);
  useUserEvent((event) => {
    if (event.type === 'audio.flush_requested' && event.payload.topicId === lastTopic.current) {
      void controller.current?.flush(event.payload.closeId).catch(() => undefined);
    }
  });
  return (
    <MicContext.Provider value={{ state, enabled, enable, disable }}>
      {children}
    </MicContext.Provider>
  );
}
