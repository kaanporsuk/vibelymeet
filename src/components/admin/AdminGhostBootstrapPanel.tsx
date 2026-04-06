/**
 * AdminGhostBootstrapPanel.tsx
 *
 * Admin observability surface for reviewing likely ghost/abandoned bootstrap-fresh profiles.
 * Read-only review interface; no destructive actions in this stream.
 * Supports filtering and detail inspection.
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { Loader2, Eye, AlertTriangle, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

type Ghost = {
  profile_id: string;
  created_at: string;
  days_since_creation: number;
  email_masked: string;
  phone_masked: string;
  onboarding_complete: boolean;
  profile_activity_score: number;
  total_messages: number;
  total_matches: number;
  total_video_sessions: number;
  total_event_regs: number;
  last_seen_at: string | null;
  account_age_hours: number;
  is_bootstrap_fresh: boolean;
  identity_collision_hints: string[];
  review_confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
};

type FilterConfidence = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';

export function AdminGhostBootstrapPanel() {
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daysThreshold, setDaysThreshold] = useState(7);
  const [confidenceFilter, setConfidenceFilter] = useState<FilterConfidence>('HIGH');
  const [selectedGhost, setSelectedGhost] = useState<Ghost | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const fetchGhosts = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc(
        'detect_ghost_bootstrap_accounts',
        {
          days_old_threshold: daysThreshold,
          min_activity_threshold: 0,
        }
      );

      if (err) throw err;

      setGhosts(data || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch ghost accounts';
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }, [daysThreshold]);

  useEffect(() => {
    void fetchGhosts();
  }, [fetchGhosts]);

  const filteredGhosts = ghosts.filter(g => {
    if (confidenceFilter === 'ALL') return true;
    return g.review_confidence === confidenceFilter;
  });

  const confidenceBadgeColor = (confidence: string) => {
    switch (confidence) {
      case 'HIGH':
        return 'bg-destructive/15 text-destructive border-destructive/30';
      case 'MEDIUM':
        return 'bg-amber-500/15 text-amber-700 border-amber-500/30';
      case 'LOW':
        return 'bg-blue-500/15 text-blue-700 border-blue-500/30';
      default:
        return 'bg-secondary text-secondary-foreground';
    }
  };

  const totalActivity = (g: Ghost) =>
    g.total_messages + g.total_matches + g.total_video_sessions + g.total_event_regs;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Ghost Bootstrap Accounts</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Review likely abandoned or duplicate bootstrap profiles. Read-only observability.
          </p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Older than (days):</label>
          <Input
            type="number"
            value={daysThreshold}
            onChange={e => setDaysThreshold(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-20"
            min={1}
            max={365}
          />
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">Confidence:</label>
          <Select value={confidenceFilter} onValueChange={v => setConfidenceFilter(v as FilterConfidence)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All</SelectItem>
              <SelectItem value="HIGH">High</SelectItem>
              <SelectItem value="MEDIUM">Medium</SelectItem>
              <SelectItem value="LOW">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={() => fetchGhosts()} disabled={isLoading} variant="outline" size="sm">
          {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          Refresh
        </Button>
      </div>

      {/* Summary */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredGhosts.length} of {ghosts.length} bootstrap ghost candidates
        {confidenceFilter !== 'ALL' && ` (${confidenceFilter} confidence)`}
      </div>

      {/* Error Display */}
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/25 text-destructive text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filteredGhosts.length === 0 && !error && (
        <div className="text-center py-8 text-muted-foreground">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-600" />
          <p>No ghost bootstrap accounts found matching criteria.</p>
        </div>
      )}

      {/* Table */}
      {!isLoading && filteredGhosts.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-24">Confidence</TableHead>
                <TableHead className="w-20">Account Age</TableHead>
                <TableHead className="w-24">Contact (masked)</TableHead>
                <TableHead className="w-16 text-right">Activity</TableHead>
                <TableHead className="w-28">Last Seen</TableHead>
                <TableHead className="w-16">Hints</TableHead>
                <TableHead className="w-12 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGhosts.map(g => (
                <TableRow key={g.profile_id} className="hover:bg-muted/50">
                  {/* Confidence */}
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn('font-medium', confidenceBadgeColor(g.review_confidence))}
                    >
                      {g.review_confidence}
                    </Badge>
                  </TableCell>

                  {/* Account Age */}
                  <TableCell className="text-sm">
                    {g.days_since_creation}d
                    <div className="text-xs text-muted-foreground">
                      {format(new Date(g.created_at), 'MMM d')}
                    </div>
                  </TableCell>

                  {/* Contact */}
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    <div>{g.email_masked}</div>
                    <div className="text-xs">{g.phone_masked}</div>
                  </TableCell>

                  {/* Activity Score */}
                  <TableCell className="text-right">
                    <div className="font-mono text-sm">{g.profile_activity_score}</div>
                    <div className="text-xs text-muted-foreground">
                      {totalActivity(g) === 0 ? '0 events' : `${totalActivity(g)} events`}
                    </div>
                  </TableCell>

                  {/* Last Seen */}
                  <TableCell className="text-sm text-muted-foreground">
                    {g.last_seen_at
                      ? format(new Date(g.last_seen_at), 'MMM d HH:mm')
                      : 'Never'}
                  </TableCell>

                  {/* Collision Hints */}
                  <TableCell>
                    {g.identity_collision_hints && g.identity_collision_hints.length > 0 ? (
                      <div className="flex items-center gap-1">
                        <AlertTriangle className="w-4 h-4 text-amber-600" />
                        <span className="text-xs text-amber-700">{g.identity_collision_hints.length}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>

                  {/* Detail Button */}
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setSelectedGhost(g);
                        setShowDetail(true);
                      }}
                    >
                      <Eye className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Detail Dialog */}
      {selectedGhost && (
        <Dialog open={showDetail} onOpenChange={setShowDetail}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Ghost Bootstrap Profile Details</DialogTitle>
              <DialogDescription>
                Review candidate for potential duplicate/ghost account
              </DialogDescription>
            </DialogHeader>

            <div className="grid grid-cols-2 gap-4 py-4">
              {/* Left Column */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Profile ID</label>
                  <code className="text-xs bg-muted p-2 rounded block mt-1 break-words">
                    {selectedGhost.profile_id}
                  </code>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Created At</label>
                  <p className="text-sm">
                    {format(new Date(selectedGhost.created_at), 'PPP p')} ({selectedGhost.days_since_creation}d ago)
                  </p>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Onboarding Status</label>
                  <Badge variant={selectedGhost.onboarding_complete ? 'default' : 'secondary'}>
                    {selectedGhost.onboarding_complete ? 'Complete' : 'Bootstrap Fresh'}
                  </Badge>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Last Seen</label>
                  <p className="text-sm">
                    {selectedGhost.last_seen_at
                      ? format(new Date(selectedGhost.last_seen_at), 'PPP p')
                      : 'Never'}
                  </p>
                </div>
              </div>

              {/* Right Column */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Activity Score</label>
                  <p className="text-2xl font-bold">{selectedGhost.profile_activity_score}</p>
                  <div className="text-xs text-muted-foreground mt-1 space-y-1">
                    <p>Messages: {selectedGhost.total_messages}</p>
                    <p>Matches: {selectedGhost.total_matches}</p>
                    <p>Video sessions: {selectedGhost.total_video_sessions}</p>
                    <p>Event registrations: {selectedGhost.total_event_regs}</p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Review Confidence</label>
                  <Badge className={cn('mt-1', confidenceBadgeColor(selectedGhost.review_confidence))}>
                    {selectedGhost.review_confidence}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Collision Hints */}
            {selectedGhost.identity_collision_hints && selectedGhost.identity_collision_hints.length > 0 && (
              <div className="border-t pt-4">
                <label className="text-xs font-semibold text-muted-foreground block mb-2">
                  <AlertTriangle className="w-3 h-3 inline mr-1 text-amber-600" />
                  Identity Collision Hints
                </label>
                <div className="space-y-1">
                  {selectedGhost.identity_collision_hints.map((hint, i) => (
                    <div key={i} className="text-sm p-2 bg-amber-500/10 rounded text-amber-700 border border-amber-500/20">
                      {hint}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Info Box */}
            <div className="border-t pt-4 bg-blue-500/5 p-3 rounded-lg border border-blue-500/20">
              <p className="text-xs text-blue-700">
                <strong>Note:</strong> This is read-only observability. Account merger, manual deletion, or other destructive 
                actions are not supported in this stream. Use for review and planning only.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
