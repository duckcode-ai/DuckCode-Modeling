import React from "react";
import { Wand2 } from "lucide-react";
import Modal from "./Modal";
import useUiStore from "../../stores/uiStore";
import AiAssistantSurface from "../ai/AiAssistantSurface";

export default function AiAssistantDialog() {
  const closeModal = useUiStore((s) => s.closeModal);
  const modalPayload = useUiStore((s) => s.modalPayload);

  return (
    <Modal
      icon={<Wand2 size={16} />}
      title="Ask AI"
      subtitle="Grounded in selected objects, DataLex YAML, indexed dbt context, and local skills."
      size="xl"
      onClose={closeModal}
      bodyClassName="pad-0"
      cardClassName="ai-assistant-card"
    >
      <AiAssistantSurface payload={modalPayload} onClose={closeModal} />
    </Modal>
  );
}
