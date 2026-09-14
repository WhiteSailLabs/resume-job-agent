'use client';

import { useState } from 'react';
import { Bot, Check, Loader2, Send, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ResumeData } from '@/components/dashboard/resume-component';
import { previewAiResumeAdjustment, updateResume } from '@/lib/api/resume';

type ChatMessage = {
  id: number;
  role: 'assistant' | 'user';
  content: string;
};

interface AiResumeChatProps {
  resumeId: string;
  onApplied: (resume: ResumeData) => void;
  onProposalChange?: (resume: ResumeData | null) => void;
}

export function AiResumeChat({ resumeId, onApplied, onProposalChange }: AiResumeChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: 'assistant',
      content: '告诉我你想怎么调整。我会同时参考当前简历和岗位 JD，只使用原简历能够支持的事实。',
    },
  ]);
  const [instruction, setInstruction] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [proposal, setProposal] = useState<ResumeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submitInstruction = async () => {
    const text = instruction.trim();
    if (!text || isGenerating || proposal) return;
    const messageId = Date.now();
    setMessages((current) => [...current, { id: messageId, role: 'user', content: text }]);
    setInstruction('');
    setError(null);
    setIsGenerating(true);
    try {
      const result = await previewAiResumeAdjustment(resumeId, text);
      setMessages((current) => [
        ...current,
        { id: messageId + 1, role: 'assistant', content: result.reply },
      ]);
      if (result.changed_paths.length) {
        setProposal(result.proposed_resume);
        onProposalChange?.(result.proposed_resume);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'AI 调整暂时失败，请重试。');
    } finally {
      setIsGenerating(false);
    }
  };

  const applyProposal = async () => {
    if (!proposal || isApplying) return;
    setIsApplying(true);
    setError(null);
    try {
      await updateResume(resumeId, proposal);
      onApplied(proposal);
      setProposal(null);
      onProposalChange?.(null);
      setMessages((current) => [
        ...current,
        { id: Date.now(), role: 'assistant', content: '修改已应用。你可以继续告诉我下一步怎么调整。' },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '应用修改失败，请重试。');
    } finally {
      setIsApplying(false);
    }
  };

  const discardProposal = () => {
    setProposal(null);
    onProposalChange?.(null);
    setMessages((current) => [
      ...current,
      { id: Date.now(), role: 'assistant', content: '这次建议已放弃，当前简历没有改变。' },
    ]);
  };

  return (
    <aside className="flex min-h-[32rem] flex-col border-2 border-black bg-white shadow-sw-default">
      <header className="border-b-2 border-black p-4">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-blue-700" />
          <h3 className="font-mono text-sm font-bold">AI 调整简历</h3>
        </div>
        <p className="mt-2 text-xs leading-5 text-steel-grey">每次先预览建议，确认后才会写入简历。</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 xl:max-h-[58vh]">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[92%] border p-3 text-sm leading-6 ${
              message.role === 'user'
                ? 'ml-auto border-blue-700 bg-blue-50'
                : 'border-black bg-background'
            }`}
          >
            <p className="mb-1 font-mono text-[10px] font-bold text-steel-grey">
              {message.role === 'user' ? '你' : '简历助手'}
            </p>
            {message.content}
          </div>
        ))}
        {isGenerating && (
          <div className="flex items-center gap-2 text-sm text-steel-grey">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在结合 JD 生成修改建议…
          </div>
        )}
        {error && <p className="border border-red-700 bg-red-50 p-3 text-xs text-red-800">{error}</p>}
      </div>

      {proposal && (
        <div className="border-t-2 border-blue-700 bg-blue-50 p-3">
          <p className="text-xs font-bold text-blue-900">修改预览已显示在中间，尚未保存</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={applyProposal} disabled={isApplying}>
              {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              应用修改
            </Button>
            <Button size="sm" variant="outline" onClick={discardProposal} disabled={isApplying}>
              <Undo2 className="h-4 w-4" /> 放弃这次
            </Button>
          </div>
        </div>
      )}

      <div className="border-t-2 border-black p-3">
        <label htmlFor="ai-resume-instruction" className="font-mono text-xs font-bold">
          继续告诉 AI 怎么改
        </label>
        <textarea
          id="ai-resume-instruction"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submitInstruction();
            }
          }}
          disabled={isGenerating || Boolean(proposal)}
          rows={4}
          maxLength={1200}
          placeholder="例如：把第一段经历写得更突出模型评测，但不要增加不存在的数据"
          className="mt-2 w-full resize-y border border-black bg-white p-3 text-sm outline-none focus:border-blue-700 disabled:bg-secondary"
        />
        <Button
          className="mt-2 w-full"
          onClick={submitInstruction}
          disabled={!instruction.trim() || isGenerating || Boolean(proposal)}
        >
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          发送调整要求
        </Button>
      </div>
    </aside>
  );
}
