"use client";

import { useState } from "react";
import { TableRow, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Users, ChevronDown, ChevronRight, UserCircle, LogIn, Mail } from "lucide-react";
import { impersonateUserAction } from "../actions";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";

export function RosterRow({ org }: { org: any }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState<string | null>(null);
  const [isUpdatingRole, setIsUpdatingRole] = useState<string | null>(null);
  const updateCustomRole = useMutation(api.memberships.updateCustomRole);

  const handleImpersonate = async (userId: string) => {
    setIsLoading(userId);
    try {
      const formData = new FormData();
      formData.append("targetUserId", userId);
      const { url } = await impersonateUserAction(formData);
      if (url) {
        window.location.href = url;
      }
    } catch (error) {
      console.error("Failed to impersonate:", error);
      alert("Failed to impersonate user.");
    } finally {
      setIsLoading(null);
    }
  };

  const getRoleColor = (role: string) => {
    const cleanRole = role?.replace('org:', '') || '';
    switch (cleanRole) {
      case "owner": return "border-primary/30 text-primary bg-primary/10";
      case "manager": return "border-muted-foreground/40 text-muted-foreground bg-muted/30";
      case "barista": return "border-border text-muted-foreground bg-muted/20";
      case "server": return "border-border/50 text-muted-foreground bg-background";
      default: return "border-muted-foreground/30 text-muted-foreground bg-muted-foreground/10";
    }
  };

  return (
    <>
      <TableRow 
        className={`border-border transition-all duration-300 cursor-pointer ${isExpanded ? 'bg-primary/5 hover:bg-primary/5' : 'hover:bg-muted/30'}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <TableCell className="relative">
          {isExpanded && (
            <motion.div 
              layoutId="active-indicator"
              className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary rounded-r-full" 
            />
          )}
          <div className="flex items-center gap-3">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold text-sm ring-1 shadow-sm transition-all duration-300 ${isExpanded ? 'bg-primary text-primary-foreground ring-primary/50 shadow-primary/20' : 'bg-primary/10 text-primary ring-primary/20'}`}>
              {org.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-foreground tracking-tight">{org.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">{org.slug || "—"}</p>
            </div>
          </div>
        </TableCell>
        <TableCell className="hidden sm:table-cell">
          {org.slug
            ? <Badge variant="outline" className="font-mono text-xs border-border/50 text-muted-foreground bg-background/50 backdrop-blur-sm">/{org.slug}</Badge>
            : <span className="text-muted-foreground/30">—</span>}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-3">
            <Badge variant="secondary" className="flex items-center gap-1.5 bg-muted/50 border-border/50">
              <Users className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="font-semibold text-foreground tabular-nums">
                {org.members?.length ?? 0}
              </span>
            </Badge>
            <div className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${isExpanded ? 'bg-primary/20 text-primary' : 'bg-transparent text-muted-foreground'}`}>
              <motion.div
                animate={{ rotate: isExpanded ? 180 : 0 }}
                transition={{ duration: 0.2, ease: "easeInOut" }}
              >
                <ChevronDown className="h-4 w-4" />
              </motion.div>
            </div>
          </div>
        </TableCell>
      </TableRow>
      
      <AnimatePresence initial={false}>
        {isExpanded && org.members && (
          <TableRow className="bg-muted/5 hover:bg-muted/5 border-none">
            <TableCell colSpan={3} className="p-0">
              <motion.div 
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
                className="overflow-hidden"
              >
                <div className="p-4 pl-16 space-y-4 shadow-inner">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="h-px flex-1 bg-gradient-to-r from-border/80 to-transparent" />
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-2">Workspace Roster</p>
                    <div className="h-px flex-1 bg-gradient-to-l from-border/80 to-transparent" />
                  </div>
                  
                  {org.members.length === 0 ? (
                    <div className="text-center py-4 text-sm text-muted-foreground">No members found.</div>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {org.members.map((member: any, idx: number) => (
                        <motion.div 
                          key={member.externalId} 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.05 + 0.1, duration: 0.3 }}
                          className="flex flex-col gap-3 p-3 rounded-xl border border-border/60 bg-background/50 backdrop-blur-sm shadow-sm hover:border-primary/30 hover:bg-primary/[0.02] transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                {member.profilePicture ? (
                                  <img src={member.profilePicture} alt={member.name} className="h-10 w-10 rounded-full border border-border/80 shadow-sm object-cover" />
                                ) : (
                                  <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center border border-border/80 shadow-sm">
                                    <UserCircle className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                )}
                                <div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-emerald-500" />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-foreground leading-tight">{member.name} {member.lastname}</p>
                                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                                  <Mail className="h-3 w-3" />
                                  <span className="truncate max-w-[120px]">{member.email}</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <select 
                                value={member.customRole || ""}
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  setIsUpdatingRole(member.externalId);
                                  try {
                                    await updateCustomRole({
                                      userId: member.externalId,
                                      orgId: org.clerkId,
                                      customRole: e.target.value
                                    });
                                  } catch (error) {
                                    console.error("Failed to update role:", error);
                                    alert("Failed to update role.");
                                  } finally {
                                    setIsUpdatingRole(null);
                                  }
                                }}
                                disabled={isUpdatingRole === member.externalId}
                                className={`text-[10px] uppercase font-mono tracking-wider px-2 py-1 rounded-md border appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all ${getRoleColor(member.customRole || member.membershipRole)}`}
                                style={{ textAlignLast: "center" }}
                              >
                                <option value="" disabled>Select Role</option>
                                <option value="owner">Owner</option>
                                <option value="manager">Manager</option>
                                <option value="barista">Barista</option>
                                <option value="server">Server</option>
                              </select>
                              {isUpdatingRole === member.externalId && (
                                <span className="text-[9px] text-muted-foreground/60 animate-pulse">Updating...</span>
                              )}
                            </div>
                          </div>
                          
                          <div className="mt-1">
                            <Button 
                              size="sm" 
                              variant="secondary" 
                              className="w-full h-8 gap-1.5 text-xs font-semibold bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-300"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleImpersonate(member.externalId);
                              }}
                              disabled={isLoading === member.externalId}
                            >
                              {isLoading === member.externalId ? (
                                <span className="animate-spin h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full" />
                              ) : (
                                <LogIn className="h-3.5 w-3.5" />
                              )}
                              Impersonate Dashboard
                            </Button>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            </TableCell>
          </TableRow>
        )}
      </AnimatePresence>
    </>
  );
}
