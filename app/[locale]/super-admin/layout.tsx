export default function SuperAdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="dark min-h-screen bg-v-bg text-v-ink">
            {children}
        </div>
    );
}
